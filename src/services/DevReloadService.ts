import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ApplicationConfiguration } from "../config/models.js";
import type { ApplicationLogger } from "../contracts/hostedApplication.js";
import { installDependencies as defaultInstallDependencies, type InstallDependenciesFn } from "./installDependencies.js";
import type { ReloadOutcome } from "./ApplicationHost.js";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const MIN_POLL_INTERVAL_MS = 200;
/**
 * Source scanning stats every watched file, which is thousands of syscalls over
 * a Docker Desktop bind mount, so it runs less often than the adapter check —
 * one `stat` per application — that carries the latency-sensitive half of the
 * loop. A source edit costs at most this much extra before its build starts.
 */
const DEFAULT_SOURCE_SCAN_INTERVAL_MS = 2000;
const BUILD_TIMEOUT_MS = 600_000;
const MAX_SCANNED_FILES = 5000;
const MAX_SCAN_DEPTH = 12;
const BUILD_LOG_TAIL_LINES = 40;

/**
 * Generated or vendored directories, skipped at any depth. A sibling's own
 * `dist/` is deliberately in here: the build writes into it, and watching it as
 * *source* would make every build trigger another build. The compiled adapter
 * inside it is watched separately, as a single file.
 */
const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
]);

/**
 * Runtime/working directories, skipped only at the repository root so a real
 * source directory such as `src/data` is still watched.
 */
const IGNORED_ROOT_DIRECTORY_NAMES = new Set(["data", "logs", "tmp", "temp"]);

export type BuildStepOutcome = "succeeded" | "failed" | "skipped";

export interface BuildStepResult {
  readonly script: string;
  readonly outcome: BuildStepOutcome;
  readonly exitCode: number | null;
  readonly output: string;
}

export type BuildRunner = (
  application: ApplicationConfiguration,
  script: string,
) => Promise<BuildStepResult>;

export interface DevReloadServiceOptions {
  readonly applications: readonly ApplicationConfiguration[];
  readonly reload: (applicationId: string) => Promise<ReloadOutcome>;
  readonly logger: ApplicationLogger;
  readonly pollIntervalMs?: number;
  /** How often the source tree is rescanned; defaults to 2000ms. */
  readonly sourceScanIntervalMs?: number;
  /** When false, adapter changes still reload but source changes never build. */
  readonly autoBuild?: boolean;
  readonly installDependencies?: InstallDependenciesFn;
  readonly runBuild?: BuildRunner;
  readonly readPackageScripts?: (repositoryRoot: string) => Promise<Readonly<Record<string, string>>>;
}

interface WatchState {
  readonly application: ApplicationConfiguration;
  /** Last signature acted upon; undefined until the first observation. */
  adapterSignature: string | undefined;
  sourceSignature: string | undefined;
  /** Signature seen on the previous tick, used to require two identical reads. */
  candidateAdapterSignature: string | undefined;
  candidateSourceSignature: string | undefined;
  observed: boolean;
  lastSourceScanAt: number;
  building: boolean;
  buildQueued: boolean;
  reloading: boolean;
  scanTruncationWarned: boolean;
}

export interface DevReloadEnvironmentOptions {
  readonly applications: readonly ApplicationConfiguration[];
  readonly reload: (applicationId: string) => Promise<ReloadOutcome>;
  readonly logger: ApplicationLogger;
}

/**
 * Development-only watcher that closes the edit → browser loop for hosted
 * sibling applications.
 *
 * Two independent signals per application, both polled rather than event-driven
 * because native `fs.watch`/inotify events do not propagate reliably from a
 * Windows-host bind mount through Docker Desktop (the same reason HomeBase's own
 * watchers already run in polling mode):
 *
 * 1. A change under the sibling's source tree runs that sibling's own build
 *    scripts — the same `build:hosted`/`build` plus `build:host` pair
 *    `scripts/rebuildApps.mjs` runs by hand.
 * 2. A change to the compiled adapter file itself (whether from the build above
 *    or from a build the developer ran elsewhere) hot-reloads that one
 *    application in place.
 *
 * Keeping the two separate means a manual `npm run rebuild:dev -- --no-restart`,
 * a sibling's own `--watch` build, and this service's builds all converge on the
 * same reload path, and neither half depends on the other working.
 *
 * A sibling's *static* assets need no reload at all: `express.static` reads them
 * from disk per request, so a rebuilt frontend bundle is live as soon as the
 * build writes it and the browser is refreshed.
 */
export class DevReloadService {
  readonly #states: WatchState[];
  readonly #reload: (applicationId: string) => Promise<ReloadOutcome>;
  readonly #logger: ApplicationLogger;
  readonly #pollIntervalMs: number;
  readonly #sourceScanIntervalMs: number;
  readonly #autoBuild: boolean;
  readonly #installDeps: InstallDependenciesFn;
  readonly #runBuild: BuildRunner;
  readonly #readPackageScripts: (repositoryRoot: string) => Promise<Readonly<Record<string, string>>>;
  readonly #inFlight = new Set<Promise<void>>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #ticking = false;
  #stopped = false;

  constructor(options: DevReloadServiceOptions) {
    this.#states = options.applications
      .filter((application) => application.enabled)
      .map((application) => ({
        application,
        adapterSignature: undefined,
        sourceSignature: undefined,
        candidateAdapterSignature: undefined,
        candidateSourceSignature: undefined,
        observed: false,
        lastSourceScanAt: 0,
        building: false,
        buildQueued: false,
        reloading: false,
        scanTruncationWarned: false,
      }));
    this.#reload = options.reload;
    this.#logger = options.logger.child({ component: "dev-reload" });
    this.#pollIntervalMs = Math.max(
      MIN_POLL_INTERVAL_MS,
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    this.#sourceScanIntervalMs = Math.max(
      0,
      options.sourceScanIntervalMs ?? DEFAULT_SOURCE_SCAN_INTERVAL_MS,
    );
    this.#autoBuild = options.autoBuild ?? true;
    this.#installDeps = options.installDependencies ?? defaultInstallDependencies;
    this.#runBuild = options.runBuild ?? runBuildScript;
    this.#readPackageScripts = options.readPackageScripts ?? readPackageScripts;
  }

  /**
   * Builds a service from environment variables, or returns undefined when hot
   * reload is switched off. Only ever called on the development startup path.
   *
   * - `HOMEBASE_DEV_HOT_RELOAD=off|false|0` disables the watcher entirely.
   * - `HOMEBASE_DEV_AUTO_BUILD=off|false|0` keeps adapter reloads but stops
   *   HomeBase from running sibling build scripts itself.
   * - `HOMEBASE_DEV_HOT_RELOAD_APPS=a,b` restricts watching to those ids.
   * - `HOMEBASE_DEV_WATCH_INTERVAL_MS` overrides the poll interval, and
   *   `HOMEBASE_DEV_SOURCE_SCAN_INTERVAL_MS` the (slower) source-scan interval.
   */
  static fromEnvironment(
    environment: Readonly<Record<string, string | undefined>>,
    options: DevReloadEnvironmentOptions,
  ): DevReloadService | undefined {
    if (isDisabled(environment.HOMEBASE_DEV_HOT_RELOAD)) return undefined;

    const only = (environment.HOMEBASE_DEV_HOT_RELOAD_APPS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const applications =
      only.length > 0
        ? options.applications.filter((application) => only.includes(application.id))
        : options.applications;

    const interval = Number.parseInt(environment.HOMEBASE_DEV_WATCH_INTERVAL_MS ?? "", 10);
    const scanInterval = Number.parseInt(
      environment.HOMEBASE_DEV_SOURCE_SCAN_INTERVAL_MS ?? "",
      10,
    );

    return new DevReloadService({
      applications,
      reload: options.reload,
      logger: options.logger,
      autoBuild: !isDisabled(environment.HOMEBASE_DEV_AUTO_BUILD),
      ...(Number.isFinite(interval) ? { pollIntervalMs: interval } : {}),
      ...(Number.isFinite(scanInterval) ? { sourceScanIntervalMs: scanInterval } : {}),
    });
  }

  start(): void {
    if (this.#timer || this.#stopped) return;
    this.#logger.log("info", "dev-reload-start", "Watching hosted applications for changes.", {
      applicationIds: this.#states.map((state) => state.application.id),
      pollIntervalMs: this.#pollIntervalMs,
      sourceScanIntervalMs: this.#sourceScanIntervalMs,
      autoBuild: this.#autoBuild,
    });
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#pollIntervalMs);
    this.#timer.unref?.();
  }

  /**
   * Stops polling and waits for any build or reload already under way, so
   * HomeBase's shutdown doesn't begin disposing adapters while a reload is
   * mid-swap.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    await this.settled();
    this.#logger.log("info", "dev-reload-stop", "Stopped watching hosted applications.");
  }

  /**
   * One polling pass over every watched application. Exposed for tests, which
   * drive it directly instead of waiting on wall-clock intervals.
   *
   * A change has to be observed identically on two consecutive passes before it
   * is acted on. That both debounces a burst of editor writes and avoids
   * importing an adapter file that a build is still in the middle of writing.
   */
  async tick(): Promise<void> {
    if (this.#ticking || this.#stopped) return;
    this.#ticking = true;
    try {
      for (const state of this.#states) {
        await this.#tickOne(state);
      }
    } finally {
      this.#ticking = false;
    }
  }

  async #tickOne(state: WatchState): Promise<void> {
    const adapterSignature = await fileSignature(state.application.adapterFile);

    const now = Date.now();
    const scanSource =
      this.#autoBuild &&
      (!state.observed || now - state.lastSourceScanAt >= this.#sourceScanIntervalMs);
    if (scanSource) state.lastSourceScanAt = now;
    const sourceSignature = scanSource ? await this.#scanSource(state) : state.sourceSignature;

    // The first pass is a baseline only: what is already on disk at startup has
    // just been loaded, so it is recorded as acted-upon and nothing is built or
    // reloaded until something actually changes afterwards.
    if (!state.observed) {
      state.observed = true;
      state.adapterSignature = adapterSignature;
      state.candidateAdapterSignature = adapterSignature;
      state.sourceSignature = sourceSignature;
      state.candidateSourceSignature = sourceSignature;
      return;
    }

    const adapterChanged = hasSettledChange(
      adapterSignature,
      state.adapterSignature,
      state.candidateAdapterSignature,
    );
    state.candidateAdapterSignature = adapterSignature;
    if (adapterChanged) {
      state.adapterSignature = adapterSignature;
      this.#spawn(this.#reloadApplication(state));
    }

    // Only a pass that actually scanned can advance the source settle state;
    // otherwise a skipped scan would compare a signature against itself and
    // trigger on the very next tick.
    if (!scanSource) return;

    const sourceChanged = hasSettledChange(
      sourceSignature,
      state.sourceSignature,
      state.candidateSourceSignature,
    );
    state.candidateSourceSignature = sourceSignature;
    if (sourceChanged) {
      state.sourceSignature = sourceSignature;
      this.#spawn(this.#buildApplication(state));
    }
  }

  /**
   * Builds and reloads run outside the polling pass so a slow build never
   * stalls the watcher, but they are tracked so shutdown and tests can wait for
   * them instead of racing them.
   */
  #spawn(work: Promise<void>): void {
    const entry = work.catch(() => {});
    this.#inFlight.add(entry);
    void entry.finally(() => this.#inFlight.delete(entry));
  }

  /** Resolves once every build and reload this watcher started has finished. */
  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.all([...this.#inFlight]);
    }
  }

  async #reloadApplication(state: WatchState): Promise<void> {
    if (state.reloading) return;
    state.reloading = true;
    const id = state.application.id;
    const startedAt = Date.now();
    try {
      const outcome = await this.#reload(id);
      if (outcome.ok) {
        this.#logger.log("info", "dev-reload-applied", "Reloaded after an adapter change.", {
          applicationId: id,
          state: outcome.state,
          durationMs: Date.now() - startedAt,
        });
      } else {
        this.#logger.log("warn", "dev-reload-rejected", "The adapter change was not reloaded.", {
          applicationId: id,
          reason: outcome.reason,
        });
      }
    } catch (error) {
      this.#logger.log("error", "dev-reload-error", "Reloading after an adapter change failed.", {
        applicationId: id,
        error,
      });
    } finally {
      state.reloading = false;
    }
  }

  async #buildApplication(state: WatchState): Promise<void> {
    if (!this.#autoBuild) return;
    if (state.building) {
      // An edit landed mid-build; the build in flight may already be stale, so
      // queue exactly one more pass rather than dropping the change or
      // stacking a build per keystroke.
      state.buildQueued = true;
      return;
    }

    state.building = true;
    try {
      do {
        state.buildQueued = false;
        await this.#runBuildPass(state);
      } while (state.buildQueued && !this.#stopped);
    } finally {
      state.building = false;
    }
  }

  async #runBuildPass(state: WatchState): Promise<void> {
    const { application } = state;
    const logger = this.#logger.child({ applicationId: application.id });
    const startedAt = Date.now();

    let scripts: Readonly<Record<string, string>>;
    try {
      scripts = await this.#readPackageScripts(application.repositoryRoot);
    } catch (error) {
      logger.log("warn", "dev-build-skipped", "The application's package.json could not be read.", {
        error,
      });
      return;
    }

    const steps = buildScriptsFor(scripts);
    if (steps.length === 0) {
      logger.log(
        "warn",
        "dev-build-skipped",
        'This application defines none of "build:hosted", "build", or "build:host"; nothing to rebuild.',
      );
      return;
    }

    // A source change can be a dependency change. installDependencies is
    // signature-cached against package.json/package-lock.json, so this is a
    // cheap no-op for the common edit and a real install exactly when needed.
    try {
      await this.#installDeps(application, logger);
    } catch (error) {
      logger.log("error", "dev-build-install-failed", "Dependency installation failed.", { error });
      return;
    }

    logger.log("info", "dev-build-begin", "Rebuilding after a source change.", { steps });

    for (const script of steps) {
      const result = await this.#runBuild(application, script);
      if (result.outcome === "failed") {
        logger.log("error", "dev-build-failed", `\`${script}\` failed; the previous build is still loaded.`, {
          script,
          exitCode: result.exitCode,
          output: tail(result.output, BUILD_LOG_TAIL_LINES),
        });
        return;
      }
    }

    // No reload is triggered here on purpose: the build's own write to the
    // adapter file is what the adapter watch picks up, so a build that produced
    // no adapter change costs nothing.
    logger.log("info", "dev-build-complete", "Rebuild finished.", {
      durationMs: Date.now() - startedAt,
    });
  }

  /** Hash of every watched source file's path, size, and mtime. */
  async #scanSource(state: WatchState): Promise<string | undefined> {
    const hash = createHash("sha1");
    let count = 0;
    let truncated = false;

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_SCAN_DEPTH || truncated) return;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

      for (const entry of entries) {
        if (truncated) return;
        if (entry.name.startsWith(".")) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
          if (depth === 0 && IGNORED_ROOT_DIRECTORY_NAMES.has(entry.name)) continue;
          await walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (++count > MAX_SCANNED_FILES) {
          truncated = true;
          return;
        }
        try {
          const stats = await stat(full);
          hash.update(`${full}:${stats.size}:${stats.mtimeMs}\n`);
        } catch {
          // The file vanished mid-scan (a build's temporary output); the next
          // pass sees a different signature and settles then.
        }
      }
    };

    await walk(state.application.repositoryRoot, 0);

    if (truncated && !state.scanTruncationWarned) {
      state.scanTruncationWarned = true;
      this.#logger.log(
        "warn",
        "dev-watch-truncated",
        `More than ${MAX_SCANNED_FILES} files under this repository; source watching is incomplete.`,
        { applicationId: state.application.id },
      );
    }
    if (count === 0) return undefined;
    return hash.digest("hex");
  }
}

/**
 * The sibling build contract, matching `scripts/rebuildApps.mjs`: a
 * frontend/general build (`build:hosted` when the app defines it, so asset URLs
 * are prefixed for its HomeBase basePath, otherwise plain `build`), then
 * `build:host`, which is what actually compiles the adapter HomeBase imports.
 */
export function buildScriptsFor(scripts: Readonly<Record<string, string>>): string[] {
  const steps: string[] = [];
  if (scripts["build:hosted"]) {
    steps.push("build:hosted");
  } else if (scripts["build"]) {
    steps.push("build");
  }
  if (scripts["build:host"]) {
    steps.push("build:host");
  }
  return steps;
}

async function readPackageScripts(repositoryRoot: string): Promise<Readonly<Record<string, string>>> {
  const raw = await readFile(path.join(repositoryRoot, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
    if (typeof command === "string") scripts[name] = command;
  }
  return scripts;
}

/**
 * True when `current` differs from what was last acted on *and* matches what
 * the previous pass saw — i.e. the change has stopped moving. Requiring two
 * identical reads both debounces a burst of editor writes and avoids importing
 * an adapter file a build is still writing.
 */
function hasSettledChange(
  current: string | undefined,
  acted: string | undefined,
  candidate: string | undefined,
): boolean {
  if (current === undefined) return false;
  if (current === acted) return false;
  return current === candidate;
}

async function fileSignature(file: string): Promise<string | undefined> {
  try {
    const stats = await stat(file);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return undefined;
  }
}

const runBuildScript: BuildRunner = (application, script) =>
  new Promise<BuildStepResult>((resolve) => {
    const packageManager = application.packageManager ?? "npm";
    const child = spawn(packageManager, ["run", script], {
      cwd: application.repositoryRoot,
      shell: true,
      detached: process.platform !== "win32",
    });

    let output = "";
    const append = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > 200_000) output = output.slice(-200_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => {
      killGroup(child.pid);
    }, BUILD_TIMEOUT_MS);
    timer.unref?.();

    const finish = (exitCode: number | null, extra?: string): void => {
      clearTimeout(timer);
      resolve({
        script,
        outcome: exitCode === 0 ? "succeeded" : "failed",
        exitCode,
        output: extra ? `${output}${extra}` : output,
      });
    };

    child.once("error", (error) => finish(null, `\n${String(error)}`));
    child.once("exit", (code) => finish(code));
  });

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    process.kill(pid);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

function tail(output: string, lines: number): string {
  const all = output.trimEnd().split(/\r?\n/);
  return all.slice(-lines).join("\n");
}

function isDisabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "off" || normalized === "false" || normalized === "0" || normalized === "no";
}
