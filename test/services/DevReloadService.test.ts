import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ApplicationConfiguration } from "../../src/config/models.js";
import type { ReloadOutcome } from "../../src/services/ApplicationHost.js";
import {
  buildScriptsFor,
  DevReloadService,
  type BuildStepResult,
} from "../../src/services/DevReloadService.js";
import { createTestLogger } from "../support/testLogger.js";

const cleanupTasks: Array<() => Promise<void>> = [];

/** Polls once, then waits for the builds/reloads that pass started. */
async function tickAndSettle(service: DevReloadService): Promise<void> {
  await service.tick();
  await service.settled();
}

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((task) => task()));
});

interface WatchFixture {
  readonly application: ApplicationConfiguration;
  readonly repositoryRoot: string;
  readonly builds: string[];
  readonly reloads: string[];
  readonly service: DevReloadService;
  writeSource(name: string, contents: string): Promise<void>;
  writeAdapter(contents: string): Promise<void>;
}

async function buildWatchFixture(
  options: {
    readonly scripts?: Record<string, string>;
    readonly autoBuild?: boolean;
    readonly sourceScanIntervalMs?: number;
    readonly buildResult?: (script: string) => BuildStepResult;
    /** "real" leaves the default spawn-based runner in place. */
    readonly runBuild?: "real";
  } = {},
): Promise<WatchFixture> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "homebase-watch-"));
  cleanupTasks.push(() => rm(workspaceRoot, { recursive: true, force: true }));

  const repositoryRoot = path.join(workspaceRoot, "WatchedApp");
  const adapterFile = path.join(repositoryRoot, "dist", "host", "index.js");
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await mkdir(path.dirname(adapterFile), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, "package.json"),
    JSON.stringify({ name: "watched-app", scripts: options.scripts ?? { "build:host": "tsc" } }),
    "utf8",
  );
  await writeFile(path.join(repositoryRoot, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await writeFile(adapterFile, "export default () => ({});\n", "utf8");

  const application: ApplicationConfiguration = {
    id: "watched-app",
    displayName: "Watched App",
    description: "An application used to exercise the development watcher.",
    slug: "watched-app",
    basePath: "/watched-app/",
    enabled: true,
    repoPath: "WatchedApp",
    repositoryRoot,
    adapterPath: "dist/host/index.js",
    adapterFile,
    contractVersion: 1,
    defaultBranch: undefined,
    packageManager: undefined,
    devCommands: [],
    tags: [],
    icon: undefined,
    category: undefined,
    sortOrder: undefined,
    dataPath: path.join(workspaceRoot, "data"),
    adapterConfig: undefined,
    startupIssue: undefined,
  };

  const builds: string[] = [];
  const reloads: string[] = [];

  const service = new DevReloadService({
    applications: [application],
    logger: createTestLogger(),
    autoBuild: options.autoBuild ?? true,
    // Scan the source tree on every pass so a test can drive tick() directly
    // without waiting out the production scan interval.
    sourceScanIntervalMs: options.sourceScanIntervalMs ?? 0,
    installDependencies: async () => {},
    reload: async (id): Promise<ReloadOutcome> => {
      reloads.push(id);
      return { ok: true, state: "ready", summary: "reloaded" };
    },
    ...(options.runBuild === "real"
      ? {}
      : {
          runBuild: async (_application, script): Promise<BuildStepResult> => {
            builds.push(script);
            return (
              options.buildResult?.(script) ?? {
                script,
                outcome: "succeeded",
                exitCode: 0,
                output: "",
              }
            );
          },
        }),
  });

  return {
    application,
    repositoryRoot,
    builds,
    reloads,
    service,
    writeSource: (name, contents) =>
      writeFile(path.join(repositoryRoot, "src", name), contents, "utf8"),
    writeAdapter: (contents) => writeFile(adapterFile, contents, "utf8"),
  };
}

describe("DevReloadService", () => {
  it("takes a baseline on its first pass without building or reloading", async () => {
    const context = await buildWatchFixture();

    await tickAndSettle(context.service);
    await tickAndSettle(context.service);

    expect(context.builds).toEqual([]);
    expect(context.reloads).toEqual([]);
  });

  it("rebuilds the sibling's own build scripts after a source change settles", async () => {
    const context = await buildWatchFixture({
      scripts: { "build:hosted": "vite build", build: "vite build", "build:host": "tsc" },
    });
    await tickAndSettle(context.service);

    await context.writeSource("index.ts", "export const value = 2; // changed\n");

    // The change is only acted on once two consecutive passes agree, so an
    // editor still writing does not trigger a half-file build.
    await tickAndSettle(context.service);
    expect(context.builds).toEqual([]);

    await tickAndSettle(context.service);
    expect(context.builds).toEqual(["build:hosted", "build:host"]);
    expect(context.reloads).toEqual([]);
  });

  it("stops after a failing build step and leaves the loaded adapter alone", async () => {
    const context = await buildWatchFixture({
      scripts: { build: "vite build", "build:host": "tsc" },
      buildResult: (script) => ({
        script,
        outcome: script === "build" ? "failed" : "succeeded",
        exitCode: script === "build" ? 1 : 0,
        output: "boom",
      }),
    });
    await tickAndSettle(context.service);
    await context.writeSource("index.ts", "export const value = 3; // changed\n");
    await tickAndSettle(context.service);
    await tickAndSettle(context.service);

    expect(context.builds).toEqual(["build"]);
    expect(context.reloads).toEqual([]);
  });

  it("hot-reloads when the compiled adapter file changes", async () => {
    const context = await buildWatchFixture();
    await tickAndSettle(context.service);

    await context.writeAdapter("export default () => ({ rebuilt: true });\n");
    await tickAndSettle(context.service);
    expect(context.reloads).toEqual([]);

    await tickAndSettle(context.service);
    expect(context.reloads).toEqual(["watched-app"]);

    // A settled adapter is not reloaded again on later passes.
    await tickAndSettle(context.service);
    await tickAndSettle(context.service);
    expect(context.reloads).toEqual(["watched-app"]);
  });

  it("still reloads adapter changes when automatic building is switched off", async () => {
    const context = await buildWatchFixture({ autoBuild: false });
    await tickAndSettle(context.service);

    await context.writeSource("index.ts", "export const value = 4; // changed\n");
    await context.writeAdapter("export default () => ({ rebuilt: true });\n");
    await tickAndSettle(context.service);
    await tickAndSettle(context.service);

    expect(context.builds).toEqual([]);
    expect(context.reloads).toEqual(["watched-app"]);
  });

  it("rescans the source tree no more often than its scan interval", async () => {
    const context = await buildWatchFixture({ sourceScanIntervalMs: 60_000 });
    await tickAndSettle(context.service);

    await context.writeSource("index.ts", "export const value = 5; // changed\n");
    await tickAndSettle(context.service);
    await tickAndSettle(context.service);
    await tickAndSettle(context.service);

    // The cheap adapter check still ran on each of those passes; the expensive
    // source scan did not, so the edit is not yet visible.
    expect(context.builds).toEqual([]);
  });

  it("ignores changes under generated directories that its own builds write", async () => {
    const context = await buildWatchFixture();
    await tickAndSettle(context.service);

    await mkdir(path.join(context.repositoryRoot, "node_modules", "left-pad"), { recursive: true });
    await writeFile(
      path.join(context.repositoryRoot, "node_modules", "left-pad", "index.js"),
      "module.exports = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(context.repositoryRoot, "dist", "bundle.js"),
      "console.log('built');\n",
      "utf8",
    );
    await tickAndSettle(context.service);
    await tickAndSettle(context.service);

    expect(context.builds).toEqual([]);
  });
});

describe("DevReloadService build execution", () => {
  it(
    "actually runs the sibling's build script and reloads the adapter it writes",
    { timeout: 60_000 },
    async () => {
      // The only test that uses the real spawn-based build runner, so the
      // `npm run <script>` path itself is covered rather than only the
      // orchestration around it. The script is plain node, not a real
      // toolchain, so it stays fast and dependency-free.
      const context = await buildWatchFixture({
        scripts: {
          "build:host":
            "node -e \"require('fs').writeFileSync('dist/host/index.js','export default () => ({ built: true });')\"",
        },
        runBuild: "real",
      });

      await tickAndSettle(context.service);
      await context.writeSource("index.ts", "export const value = 6; // changed\n");
      await tickAndSettle(context.service);
      await tickAndSettle(context.service);

      const adapter = await readFile(
        path.join(context.repositoryRoot, "dist", "host", "index.js"),
        "utf8",
      );
      expect(adapter).toContain("built: true");

      // The build's write to the adapter is what the adapter watch picks up.
      await tickAndSettle(context.service);
      await tickAndSettle(context.service);
      expect(context.reloads).toEqual(["watched-app"]);
    },
  );
});

describe("buildScriptsFor", () => {
  it("prefers build:hosted over build and always appends build:host", () => {
    expect(buildScriptsFor({ "build:hosted": "x", build: "y", "build:host": "z" })).toEqual([
      "build:hosted",
      "build:host",
    ]);
    expect(buildScriptsFor({ build: "y", "build:host": "z" })).toEqual(["build", "build:host"]);
    expect(buildScriptsFor({ "build:host": "z" })).toEqual(["build:host"]);
    expect(buildScriptsFor({ test: "vitest" })).toEqual([]);
  });
});

describe("DevReloadService.fromEnvironment", () => {
  const options = {
    applications: [],
    reload: async (): Promise<ReloadOutcome> => ({ ok: true, state: "ready", summary: "" }),
    logger: createTestLogger(),
  };

  it("is enabled by default and disabled by an explicit off switch", () => {
    expect(DevReloadService.fromEnvironment({}, options)).toBeInstanceOf(DevReloadService);
    expect(DevReloadService.fromEnvironment({ HOMEBASE_DEV_HOT_RELOAD: "off" }, options)).toBeUndefined();
    expect(DevReloadService.fromEnvironment({ HOMEBASE_DEV_HOT_RELOAD: "false" }, options)).toBeUndefined();
    expect(DevReloadService.fromEnvironment({ HOMEBASE_DEV_HOT_RELOAD: "0" }, options)).toBeUndefined();
  });
});
