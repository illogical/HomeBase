import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import type { RegistryApplication } from "../../src/config/models.js";
import { ApplicationHost } from "../../src/services/ApplicationHost.js";
import { ConfigService } from "../../src/services/ConfigService.js";
import { createConfigFixture, type ConfigFixture } from "../support/configFixture.js";
import { createTestLogger } from "../support/testLogger.js";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((task) => task()));
});

/**
 * A minimal hosted adapter written to disk as real source, so a reload has an
 * actual file to re-import. `router` is a plain middleware function rather than
 * an express Router: the adapter lives outside the project tree, where a bare
 * `express` import would not resolve, and `resolveHandler` only ever calls it.
 */
function adapterSource(version: string): string {
  return `import { appendFileSync } from "node:fs";
import { join } from "node:path";

export default function create(options) {
  return {
    contractVersion: 1,
    router: (_request, response) => {
      response.status(200).type("text/plain").end(${JSON.stringify(version)});
    },
    async getStatus() {
      return { state: "ready", summary: ${JSON.stringify(version)}, since: new Date().toISOString() };
    },
    async dispose() {
      appendFileSync(join(options.dataPath, "disposals.txt"), ${JSON.stringify(`${version}\n`)});
    },
  };
}
`;
}

interface ReloadFixture {
  readonly fixture: ConfigFixture;
  readonly workspaceRoot: string;
  readonly adapterFile: string;
  readonly dataPath: string;
  readonly host: ApplicationHost;
  readonly app: ReturnType<typeof createApp>["app"];
  writeAdapter(source: string): Promise<void>;
  disposals(): Promise<string>;
}

async function buildReloadFixture(initialVersion = "v1"): Promise<ReloadFixture> {
  const fixture = await createConfigFixture();
  cleanupTasks.push(fixture.cleanup);

  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "homebase-reload-"));
  cleanupTasks.push(() => rm(workspaceRoot, { recursive: true, force: true }));

  const adapterFile = path.join(workspaceRoot, "ReloadApp", "dist", "host", "index.mjs");
  await mkdir(path.dirname(adapterFile), { recursive: true });
  await writeFile(adapterFile, adapterSource(initialVersion), "utf8");

  const application: RegistryApplication = {
    id: "reload-app",
    displayName: "Reload App",
    description: "An application used to exercise adapter hot reload.",
    slug: "reload-app",
    enabled: true,
    repoPath: "ReloadApp",
    adapterPath: "dist/host/index.mjs",
    contractVersion: 1,
  };
  await fixture.writeRegistry({
    schemaVersion: 1,
    server: { port: 17000 },
    applications: [application],
  });

  const configService = await ConfigService.load({
    projectRoot: fixture.projectRoot,
    environment: {
      HOMEBASE_WORKSPACE_PATH: workspaceRoot,
      HOMEBASE_DATA_PATH: fixture.dataRoot,
    },
    nodeVersion: "24.0.0",
  });
  const host = await ApplicationHost.loadAll(configService, createTestLogger(), {
    installDependencies: async () => {},
  });
  await host.settled();

  const dataPath = configService.applications[0]!.dataPath;

  return {
    fixture,
    workspaceRoot,
    adapterFile,
    dataPath,
    host,
    app: createApp(configService, host).app,
    writeAdapter: (source) => writeFile(adapterFile, source, "utf8"),
    disposals: async () => {
      try {
        return await readFile(path.join(dataPath, "disposals.txt"), "utf8");
      } catch {
        return "";
      }
    },
  };
}

describe("ApplicationHost.reload", () => {
  it("serves the rebuilt adapter's responses after a reload, disposing the old instance first", async () => {
    const context = await buildReloadFixture("v1");

    const before = await request(context.app).get("/reload-app/anything");
    expect(before.status).toBe(200);
    expect(before.text).toBe("v1");

    await context.writeAdapter(adapterSource("v2"));
    const outcome = await context.host.reload("reload-app");

    expect(outcome).toEqual({ ok: true, state: "ready", summary: "v2" });
    expect(await context.disposals()).toBe("v1\n");

    const after = await request(context.app).get("/reload-app/anything");
    expect(after.status).toBe(200);
    expect(after.text).toBe("v2");
  });

  it("reports the application unavailable when the rebuilt adapter cannot load", async () => {
    const context = await buildReloadFixture("v1");

    await context.writeAdapter("export default null;\n");
    const outcome = await context.host.reload("reload-app");

    expect(outcome).toEqual({
      ok: true,
      state: "unavailable",
      summary: "The hosted adapter could not be loaded.",
    });

    const response = await request(context.app).get("/reload-app/anything");
    expect(response.status).toBe(503);
    expect(response.body.state).toBe("unavailable");
  });

  it("recovers a previously failed reload once the adapter builds again", async () => {
    const context = await buildReloadFixture("v1");

    await context.writeAdapter("export default null;\n");
    await context.host.reload("reload-app");
    await context.writeAdapter(adapterSource("v3"));

    const outcome = await context.host.reload("reload-app");
    expect(outcome).toEqual({ ok: true, state: "ready", summary: "v3" });
    expect((await request(context.app).get("/reload-app/anything")).text).toBe("v3");
  });

  it("rejects a reload for an unknown application and after shutdown has begun", async () => {
    const context = await buildReloadFixture("v1");

    expect(await context.host.reload("no-such-app")).toEqual({ ok: false, reason: "unknown" });

    await context.host.shutdown();
    expect(await context.host.reload("reload-app")).toEqual({
      ok: false,
      reason: "shutting-down",
    });
  });

  it("rejects a concurrent reload of the same application as busy", async () => {
    const context = await buildReloadFixture("v1");
    await context.writeAdapter(adapterSource("v2"));

    const [first, second] = await Promise.all([
      context.host.reload("reload-app"),
      context.host.reload("reload-app"),
    ]);

    expect(first).toEqual({ ok: true, state: "ready", summary: "v2" });
    expect(second).toEqual({ ok: false, reason: "busy" });
  });

  it("exposes reload over POST /api/applications/:id/reload", async () => {
    const context = await buildReloadFixture("v1");
    await context.writeAdapter(adapterSource("v2"));

    const response = await request(context.app).post("/api/applications/reload-app/reload");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ state: "ready", statusSummary: "v2" });
    expect((await request(context.app).get("/reload-app/anything")).text).toBe("v2");

    const unknown = await request(context.app).post("/api/applications/nope/reload");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "unknown" });
  });
});
