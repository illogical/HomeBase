import { mkdir } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import express, { Router, type Express, type RequestHandler } from "express";
import type { ApplicationConfiguration } from "../config/models.js";
import {
  HOSTED_CONTRACT_VERSION,
  type ApplicationLifecycleState,
  type ApplicationLogger,
  type CreateHostedApplication,
  type Disposer,
  type HostedApplication,
} from "../contracts/hostedApplication.js";
import { installDependencies as defaultInstallDependencies, type InstallDependenciesFn } from "./installDependencies.js";
import type { ConfigService } from "./ConfigService.js";

// Generous enough to cover npm install over a Docker Desktop Windows-host
// bind mount, where filesystem-heavy work against a large node_modules
// (e.g. LMEval's ~700-package tree) can be an order of magnitude slower
// than on a native filesystem. 120s proved too tight in practice — real,
// no-op-equivalent installs were timing out — so this is set generously.
const INSTALL_TIMEOUT_MS = 300_000;
const IMPORT_AND_FACTORY_TIMEOUT_MS = 30_000;
const INITIALIZE_TIMEOUT_MS = 10_000;
const ATTACH_REALTIME_TIMEOUT_MS = 5000;
const STATUS_TIMEOUT_MS = 2000;
const ACTIVE_WORK_TIMEOUT_MS = 2000;
const SHUTDOWN_GRACE_MS = 5000;
const DISPOSE_TIMEOUT_MS = 5000;
const SHUTDOWN_WATCHDOG_MS = 20_000;

type InternalState =
  | "disabled"
  | "loading"
  | "initializing"
  | "unavailable"
  | "loaded";

export interface LoadedApplication {
  readonly application: ApplicationConfiguration;
  readonly state: ApplicationLifecycleState;
  readonly summary: string;
  readonly since: string;
  readonly instance: HostedApplication | undefined;
  readonly realtimeDisposer: Disposer | undefined;
}

interface ApplicationRecord {
  readonly application: ApplicationConfiguration;
  state: InternalState;
  summary: string;
  since: string;
  instance: HostedApplication | undefined;
  realtimeDisposer: Disposer | undefined;
}

export interface ApplicationHostOptions {
  readonly installDependencies?: InstallDependenciesFn;
}

export type ReloadRejection = "unknown" | "disabled" | "busy" | "shutting-down";

export type ReloadOutcome =
  | {
      readonly ok: true;
      readonly state: ApplicationLifecycleState;
      readonly summary: string;
    }
  | { readonly ok: false; readonly reason: ReloadRejection };

class TimeoutError extends Error {
  constructor(operation: string, ms: number) {
    super(`${operation} timed out after ${ms}ms.`);
    this.name = "TimeoutError";
  }
}

async function withTimeout<T>(
  operation: string,
  ms: number,
  run: () => Promise<T>,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new TimeoutError(operation, ms));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class ApplicationHost {
  readonly #records: ApplicationRecord[];
  readonly #recordsById: ReadonlyMap<string, ApplicationRecord>;
  readonly #logger: ApplicationLogger;
  readonly #pendingLoads: Promise<void>[] = [];
  readonly #hostOrigin: string | undefined;
  readonly #installDeps: InstallDependenciesFn;
  readonly #reloads = new Map<string, Promise<void>>();
  #server: Server | undefined;
  #shuttingDown = false;
  #shutdownPromise: Promise<void> | undefined;

  private constructor(
    records: ApplicationRecord[],
    logger: ApplicationLogger,
    hostOrigin: string | undefined,
    installDeps: InstallDependenciesFn,
  ) {
    this.#records = records;
    this.#recordsById = new Map(records.map((record) => [record.application.id, record]));
    this.#logger = logger;
    this.#hostOrigin = hostOrigin;
    this.#installDeps = installDeps;
  }

  static async loadAll(
    configService: ConfigService,
    rootLogger: ApplicationLogger,
    options: ApplicationHostOptions = {},
  ): Promise<ApplicationHost> {
    const installDeps = options.installDependencies ?? defaultInstallDependencies;
    const records = configService.applications.map((application) => createInitialRecord(application));
    const host = new ApplicationHost(records, rootLogger, configService.hostOrigin, installDeps);

    for (const record of records) {
      if (record.state !== "loading") continue;
      host.#track(host.#loadOne(record));
    }

    return host;
  }

  /** Resolves once every application's background load has reached a terminal state. Test-only. */
  async settled(): Promise<void> {
    await Promise.all(this.#pendingLoads);
  }

  /**
   * Re-attempts loading a currently "unavailable" application (e.g. after a
   * transient install failure) using the same pipeline as the initial boot.
   * Returns false without effect if the app is unknown or not currently
   * "unavailable" (already loading or loaded).
   */
  retry(id: string): boolean {
    const record = this.#recordsById.get(id);
    if (!record || record.state !== "unavailable") return false;

    record.state = "loading";
    record.summary = "Waiting to retry.";
    record.since = new Date().toISOString();
    this.#track(this.#loadOne(record));
    return true;
  }

  /**
   * Development hot reload: re-imports an application's compiled adapter from
   * disk and swaps the live instance, without restarting HomeBase.
   *
   * Unlike retry() this is allowed from any non-disabled state, including
   * "loaded" — a working application is the normal case for a reload. The old
   * instance is disposed before its replacement is imported, so an adapter
   * holding an exclusive resource (a database file, a socket) releases it
   * before the new one claims it. The cost of that ordering is that a reload
   * whose new adapter fails to load leaves the application "unavailable" where
   * a working one stood a moment ago; that is reported honestly through the
   * normal state/summary path rather than papered over, and the next
   * successful reload restores it.
   *
   * Resolves once the swap has reached a terminal state. Requests arriving
   * during the swap window get the same 503 + state/summary body any
   * not-yet-loaded application returns.
   */
  async reload(id: string): Promise<ReloadOutcome> {
    const record = this.#recordsById.get(id);
    if (!record) return { ok: false, reason: "unknown" };
    if (this.#shuttingDown) return { ok: false, reason: "shutting-down" };
    if (record.state === "disabled") return { ok: false, reason: "disabled" };
    if (this.#reloads.has(id) || record.state === "loading" || record.state === "initializing") {
      return { ok: false, reason: "busy" };
    }

    const running = this.#performReload(record);
    this.#reloads.set(id, running);
    this.#track(running);
    try {
      await running;
    } finally {
      this.#reloads.delete(id);
    }

    const { state, summary } = await this.statusFor(id);
    return { ok: true, state, summary };
  }

  async #performReload(record: ApplicationRecord): Promise<void> {
    const logger = this.#childLogger(record.application.id);
    logger.log("info", "reload-begin", "Reloading the hosted adapter from disk.");

    record.state = "loading";
    record.summary = "Reloading the updated adapter.";
    record.since = new Date().toISOString();

    await this.#disposeRecord(record);
    record.instance = undefined;
    record.realtimeDisposer = undefined;

    await this.#loadOne(record, { cacheBust: true });

    // Read through a helper: #loadOne mutates record.state across awaits, which
    // TypeScript's narrowing from the assignment above cannot see.
    if (currentState(record) === "loaded") {
      logger.log("info", "reload-complete", "The hosted adapter was reloaded.");
    } else {
      logger.log("warn", "reload-failed", "The hosted adapter could not be reloaded.", {
        summary: record.summary,
      });
    }
  }

  /**
   * Keeps `#pendingLoads` a live set of in-flight work rather than an
   * append-only history: shutdown and settled() still await everything that is
   * actually running, but a long development session's repeated reloads don't
   * each retain a settled promise.
   */
  #track(work: Promise<void>): void {
    const entry = work.then(
      () => {},
      () => {
        // #loadOne and #performReload always resolve the record to a terminal
        // state themselves; this only stops one application's background work
        // from rejecting the settled()/shutdown aggregate.
      },
    );
    this.#pendingLoads.push(entry);
    void entry.finally(() => {
      const index = this.#pendingLoads.indexOf(entry);
      if (index >= 0) this.#pendingLoads.splice(index, 1);
    });
  }

  mountAll(app: Express): void {
    for (const record of this.#records) {
      if (record.state === "disabled") continue;
      mountApplication(app, record);
    }
  }

  async attachRealtime(server: Server): Promise<void> {
    this.#server = server;
    await Promise.all(
      this.#records
        .filter((record) => record.state === "loaded")
        .map((record) => this.#attachRealtimeIfReady(record)),
    );
  }

  async #attachRealtimeIfReady(record: ApplicationRecord): Promise<void> {
    if (!this.#server || record.state !== "loaded" || !record.instance?.attachRealtime) return;
    const logger = this.#childLogger(record.application.id);
    try {
      const disposer = await withTimeout(
        "attachRealtime",
        ATTACH_REALTIME_TIMEOUT_MS,
        () => Promise.resolve(record.instance!.attachRealtime!(this.#server!)),
      );
      record.realtimeDisposer = disposer ?? undefined;
      logger.log("info", "realtime-attached", "Realtime handler attached.");
    } catch (error) {
      logger.log("warn", "realtime-attach-failed", "Realtime attachment failed.", {
        error,
      });
    }
  }

  async statusFor(id: string): Promise<{ state: ApplicationLifecycleState; summary: string }> {
    const record = this.#recordsById.get(id);
    if (!record) {
      return { state: "unavailable", summary: "This application is not configured." };
    }
    if (record.state !== "loaded") {
      return { state: record.state, summary: record.summary };
    }
    if (this.#shuttingDown) {
      return { state: "stopping", summary: "HomeBase is shutting down." };
    }

    const logger = this.#childLogger(record.application.id);
    try {
      const status = await withTimeout("getStatus", STATUS_TIMEOUT_MS, () =>
        record.instance!.getStatus(),
      );
      if (
        status !== null &&
        typeof status === "object" &&
        (status.state === "ready" || status.state === "degraded") &&
        typeof status.summary === "string"
      ) {
        return { state: status.state, summary: status.summary };
      }
      logger.log("warn", "status-contract-violation", "getStatus() returned an invalid value.");
      return {
        state: "degraded",
        summary: "This application reported an invalid status.",
      };
    } catch (error) {
      logger.log("warn", "status-contract-violation", "getStatus() failed or timed out.", {
        error,
      });
      return {
        state: "degraded",
        summary: "This application's status could not be determined.",
      };
    }
  }

  async shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#shutdownPromise = this.#performShutdown();
    return this.#shutdownPromise;
  }

  async #performShutdown(): Promise<void> {
    this.#shuttingDown = true;
    this.#logger.log("info", "shutdown-begin", "HomeBase shutdown starting.");

    const watchdog = setTimeout(() => {
      this.#logger.log("fatal", "shutdown-timeout", "Shutdown watchdog expired; forcing exit.");
      process.exit(1);
    }, SHUTDOWN_WATCHDOG_MS);

    try {
      try {
        this.#server?.close();
      } catch {
        // Server was already closed or never started; nothing further to do.
      }

      // Let in-flight background loads reach a terminal state so #loadOne's
      // own shutdown check can dispose anything it just finished creating.
      await Promise.all(this.#pendingLoads);

      await this.#waitForActiveWork();
      await this.#disposeAll();

      if (this.#logger.flush) {
        await this.#logger.flush();
      }
      this.#logger.log("info", "shutdown-complete", "HomeBase shutdown complete.");
    } finally {
      clearTimeout(watchdog);
    }
  }

  async #waitForActiveWork(): Promise<void> {
    const loaded = this.#records.filter((record) => record.state === "loaded");
    const results = await Promise.all(
      loaded.map(async (record) => {
        if (!record.instance?.getActiveWork) return false;
        try {
          const status = await withTimeout("getActiveWork", ACTIVE_WORK_TIMEOUT_MS, () =>
            record.instance!.getActiveWork!(),
          );
          return status.hasActiveWork;
        } catch {
          return false;
        }
      }),
    );
    if (results.some(Boolean)) {
      await delay(SHUTDOWN_GRACE_MS);
    }
  }

  async #disposeAll(): Promise<void> {
    const loaded = this.#records.filter((record) => record.state === "loaded");
    for (const record of loaded.reverse()) {
      await this.#disposeRecord(record);
    }
  }

  /**
   * Disposes one application's realtime handler and instance under the shared
   * bounded timeout. Used by shutdown and by reload, so a hot reload releases
   * an old instance's resources exactly the way a shutdown does.
   */
  async #disposeRecord(record: ApplicationRecord): Promise<void> {
    if (!record.instance && !record.realtimeDisposer) return;
    const logger = this.#childLogger(record.application.id);
    try {
      await withTimeout("dispose", DISPOSE_TIMEOUT_MS, async () => {
        if (record.realtimeDisposer) {
          await record.realtimeDisposer();
        }
        await record.instance?.dispose?.();
      });
      logger.log("info", "dispose-complete", "Application disposed.");
    } catch (error) {
      logger.log("warn", "dispose-failed", "Application disposal failed or timed out.", {
        error,
      });
    }
  }

  #childLogger(applicationId: string): ApplicationLogger {
    return this.#logger.child({ applicationId });
  }

  async #loadOne(record: ApplicationRecord, loadOptions: { cacheBust?: boolean } = {}): Promise<void> {
    const { application } = record;
    const logger = this.#childLogger(application.id);

    record.summary = "Installing dependencies.";
    const installController = new AbortController();
    try {
      await withTimeout(
        "installDependencies",
        INSTALL_TIMEOUT_MS,
        () => this.#installDeps(application, logger, installController.signal),
        () => installController.abort(),
      );
    } catch (error) {
      logger.log("error", "install-failed", "Dependency installation failed.", { error });
      record.state = "unavailable";
      record.summary = "Dependencies could not be installed.";
      return;
    }

    logger.log("info", "load-begin", "Loading hosted adapter.");
    record.summary = "Loading hosted adapter.";

    let instance: HostedApplication;
    try {
      instance = await withTimeout(
        "import",
        IMPORT_AND_FACTORY_TIMEOUT_MS,
        async (): Promise<HostedApplication> => {
          // Node's ESM loader caches modules by resolved URL and cannot unload
          // one, so a reload has to import a *different* URL to see new code
          // on disk. The cost is that the previous module graph (and anything
          // its closures captured) stays resident — a bounded, development-only
          // leak, which is why cacheBust is never set on the startup path.
          const moduleUrl = pathToFileURL(application.adapterFile).href;
          const specifier = loadOptions.cacheBust
            ? `${moduleUrl}?homebaseReload=${Date.now()}`
            : moduleUrl;
          const imported = (await import(specifier)) as { default?: unknown };
          const factory = imported.default;
          if (typeof factory !== "function") {
            throw new Error("The adapter module has no default export function.");
          }
          await mkdir(application.dataPath, { recursive: true });
          const options = {
            applicationId: application.id,
            repositoryRoot: application.repositoryRoot,
            basePath: application.basePath,
            hostOrigin: this.#hostOrigin,
            dataPath: application.dataPath,
            config: application.adapterConfig,
            logger,
          };
          return (factory as CreateHostedApplication)(options);
        },
      );
    } catch (error) {
      logger.log("error", "load-failed", "The hosted adapter could not be loaded.", { error });
      record.state = "unavailable";
      record.summary = "The hosted adapter could not be loaded.";
      return;
    }

    if (
      instance === null ||
      typeof instance !== "object" ||
      typeof instance.getStatus !== "function" ||
      instance.contractVersion !== HOSTED_CONTRACT_VERSION
    ) {
      logger.log(
        "error",
        "load-incompatible",
        "The hosted adapter is incompatible or failed to initialize.",
      );
      record.state = "unavailable";
      record.summary = "The hosted adapter is incompatible or failed to initialize.";
      return;
    }

    try {
      if (instance.initialize) {
        record.state = "initializing";
        record.summary = "Initializing application.";
        await withTimeout("initialize", INITIALIZE_TIMEOUT_MS, () => instance.initialize!());
      }
    } catch (error) {
      logger.log("error", "initialize-failed", "The hosted adapter failed to initialize.", {
        error,
      });
      record.state = "unavailable";
      record.summary = "The hosted adapter failed to initialize.";
      return;
    }

    if (this.#shuttingDown) {
      try {
        await instance.dispose?.();
      } catch {
        // Best effort: HomeBase is already shutting down.
      }
      record.state = "unavailable";
      record.summary = "HomeBase is shutting down.";
      return;
    }

    logger.log("info", "load-complete", "Hosted adapter loaded.");
    record.state = "loaded";
    record.summary = "This application is loaded.";
    record.since = new Date().toISOString();
    record.instance = instance;
    await this.#attachRealtimeIfReady(record);
  }
}

function currentState(record: ApplicationRecord): InternalState {
  return record.state;
}

function createInitialRecord(application: ApplicationConfiguration): ApplicationRecord {
  const since = new Date().toISOString();

  if (!application.enabled) {
    return {
      application,
      state: "disabled",
      summary: "This application is disabled in the HomeBase configuration.",
      since,
      instance: undefined,
      realtimeDisposer: undefined,
    };
  }

  if (application.startupIssue) {
    return {
      application,
      state: "unavailable",
      summary: application.startupIssue.message,
      since,
      instance: undefined,
      realtimeDisposer: undefined,
    };
  }

  return {
    application,
    state: "loading",
    summary: "Waiting to load.",
    since,
    instance: undefined,
    realtimeDisposer: undefined,
  };
}

function resolveHandler(record: ApplicationRecord): RequestHandler {
  const instance = record.instance;
  const handlers: RequestHandler[] = [];

  if (instance?.router) {
    handlers.push(instance.router);
  }
  if (instance?.staticAssets) {
    const { directory, spaFallback } = instance.staticAssets;
    handlers.push(express.static(directory, { fallthrough: spaFallback }));
    if (spaFallback) {
      handlers.push((_request, response, next) => {
        response.sendFile(join(directory, "index.html"), (error) => {
          if (error) next(error);
        });
      });
    }
  }
  if (handlers.length === 0) {
    handlers.push((_request, response) => {
      response.status(404).json({ error: "not_found" });
    });
  }

  // Chain router -> static -> SPA fallback so an app that provides both a
  // router and staticAssets falls through to the static/SPA handler for any
  // path the router itself doesn't own (e.g. the bare base path), instead of
  // the router's unmatched-route 404 short-circuiting everything after it.
  return (request, response, next) => {
    let index = 0;
    const runNext = (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      const handler = handlers[index++];
      if (!handler) {
        next();
        return;
      }
      handler(request, response, runNext);
    };
    runNext();
  };
}

function mountApplication(app: Express, record: ApplicationRecord): void {
  const { basePath, slug } = record.application;
  app.get(`/${slug}`, (request, response, next) => {
    if (request.path === basePath) {
      next();
      return;
    }
    response.redirect(308, basePath);
  });

  const router = Router();

  // Cached lazily once the record first reaches "loaded", so a hosted
  // application's router/static middleware isn't rebuilt on every request.
  let cachedInstance: HostedApplication | undefined;
  let cachedHandler: RequestHandler | undefined;

  router.use((request, response, next) => {
    if (record.state !== "loaded" || !record.instance) {
      response.status(503).json({ state: record.state, statusSummary: record.summary });
      return;
    }
    if (cachedHandler === undefined || cachedInstance !== record.instance) {
      cachedInstance = record.instance;
      cachedHandler = resolveHandler(record);
    }
    cachedHandler(request, response, next);
  });

  app.use(basePath, router);
}
