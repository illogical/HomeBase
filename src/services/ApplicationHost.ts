import { mkdir } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import express, { Router, type Express } from "express";
import type { ApplicationConfiguration } from "../config/models.js";
import {
  HOSTED_CONTRACT_VERSION,
  type ApplicationLifecycleState,
  type ApplicationLogger,
  type CreateHostedApplication,
  type Disposer,
  type HostedApplication,
} from "../contracts/hostedApplication.js";
import type { ConfigService } from "./ConfigService.js";

const IMPORT_AND_FACTORY_TIMEOUT_MS = 5000;
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
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(operation, ms)), ms);
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
  #server: Server | undefined;
  #shuttingDown = false;
  #shutdownPromise: Promise<void> | undefined;

  private constructor(records: ApplicationRecord[], logger: ApplicationLogger) {
    this.#records = records;
    this.#recordsById = new Map(records.map((record) => [record.application.id, record]));
    this.#logger = logger;
  }

  static async loadAll(
    configService: ConfigService,
    rootLogger: ApplicationLogger,
  ): Promise<ApplicationHost> {
    const records: ApplicationRecord[] = [];
    for (const application of configService.applications) {
      records.push(await loadOne(application, configService.hostOrigin, rootLogger));
    }
    return new ApplicationHost(records, rootLogger);
  }

  mountAll(app: Express): void {
    for (const record of this.#records) {
      if (record.state === "disabled") continue;
      mountApplication(app, record);
    }
  }

  async attachRealtime(server: Server): Promise<void> {
    this.#server = server;
    for (const record of this.#records) {
      if (record.state !== "loaded" || !record.instance?.attachRealtime) continue;
      const logger = this.#childLogger(record.application.id);
      try {
        const disposer = await withTimeout(
          "attachRealtime",
          ATTACH_REALTIME_TIMEOUT_MS,
          () => Promise.resolve(record.instance!.attachRealtime!(server)),
        );
        record.realtimeDisposer = disposer ?? undefined;
        logger.log("info", "realtime-attached", "Realtime handler attached.");
      } catch (error) {
        logger.log("warn", "realtime-attach-failed", "Realtime attachment failed.", {
          error,
        });
      }
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
  }

  #childLogger(applicationId: string): ApplicationLogger {
    return this.#logger.child({ applicationId });
  }
}

async function loadOne(
  application: ApplicationConfiguration,
  hostOrigin: string | undefined,
  rootLogger: ApplicationLogger,
): Promise<ApplicationRecord> {
  const logger = rootLogger.child({ applicationId: application.id });
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

  logger.log("info", "load-begin", "Loading hosted adapter.");

  let instance: HostedApplication;
  try {
    instance = await withTimeout(
      "import",
      IMPORT_AND_FACTORY_TIMEOUT_MS,
      async (): Promise<HostedApplication> => {
        const moduleUrl = pathToFileURL(application.adapterFile).href;
        const imported = (await import(moduleUrl)) as { default?: unknown };
        const factory = imported.default;
        if (typeof factory !== "function") {
          throw new Error("The adapter module has no default export function.");
        }
        await mkdir(application.dataPath, { recursive: true });
        const options = {
          applicationId: application.id,
          repositoryRoot: application.repositoryRoot,
          basePath: application.basePath,
          hostOrigin,
          dataPath: application.dataPath,
          config: application.adapterConfig,
          logger,
        };
        return (factory as CreateHostedApplication)(options);
      },
    );
  } catch (error) {
    logger.log("error", "load-failed", "The hosted adapter could not be loaded.", { error });
    return {
      application,
      state: "unavailable",
      summary: "The hosted adapter could not be loaded.",
      since,
      instance: undefined,
      realtimeDisposer: undefined,
    };
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
    return {
      application,
      state: "unavailable",
      summary: "The hosted adapter is incompatible or failed to initialize.",
      since,
      instance: undefined,
      realtimeDisposer: undefined,
    };
  }

  try {
    if (instance.initialize) {
      await withTimeout("initialize", INITIALIZE_TIMEOUT_MS, () => instance.initialize!());
    }
  } catch (error) {
    logger.log("error", "initialize-failed", "The hosted adapter failed to initialize.", {
      error,
    });
    return {
      application,
      state: "unavailable",
      summary: "The hosted adapter failed to initialize.",
      since,
      instance: undefined,
      realtimeDisposer: undefined,
    };
  }

  logger.log("info", "load-complete", "Hosted adapter loaded.");
  return {
    application,
    state: "loaded",
    summary: "This application is loaded.",
    since,
    instance,
    realtimeDisposer: undefined,
  };
}

function mountApplication(app: Express, record: ApplicationRecord): void {
  const { basePath, slug } = record.application;
  app.get(`/${slug}`, (_request, response) => {
    response.redirect(308, basePath);
  });

  const router = Router();

  if (record.state === "unavailable") {
    router.use((_request, response) => {
      response.status(503).json({ state: record.state, statusSummary: record.summary });
    });
    app.use(basePath, router);
    return;
  }

  const instance = record.instance;
  let handled = false;
  if (instance?.router) {
    router.use(instance.router);
    handled = true;
  }
  if (instance?.staticAssets) {
    const { directory, spaFallback } = instance.staticAssets;
    router.use(express.static(directory, { fallthrough: spaFallback }));
    if (spaFallback) {
      router.use((_request, response, next) => {
        response.sendFile(join(directory, "index.html"), (error) => {
          if (error) next(error);
        });
      });
    }
    handled = true;
  }
  if (!handled) {
    router.use((_request, response) => {
      response.status(404).json({ error: "not_found" });
    });
  }

  app.use(basePath, router);
}
