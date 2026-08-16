import { mkdir } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../../src/config/ConfigurationError.js";
import { startServer, type StartedHomeBase } from "../../src/startServer.js";
import { createConfigFixture, type ConfigFixture } from "../support/configFixture.js";
import { fixtureAdaptersWorkspaceRoot, fixtureApplication } from "../support/fixtureAdapters.js";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((task) => task()));
});

async function buildFixture(): Promise<ConfigFixture> {
  const fixture = await createConfigFixture();
  cleanupTasks.push(fixture.cleanup);
  return fixture;
}

function fakeDashboard() {
  const close = vi.fn(async () => undefined);
  return { initializeDashboard: vi.fn(async () => ({ close })), close };
}

describe("startServer end-to-end with hosted fixtures", () => {
  it("mounts several fixtures, isolates them, and reports real lifecycle states", async () => {
    const fixture = await buildFixture();
    await fixture.writeRegistry({
      schemaVersion: 1,
      server: { port: 17000 },
      applications: [
        fixtureApplication("routes-app", "routes", { sortOrder: 1 }),
        fixtureApplication("static-app", "static-assets", { sortOrder: 2 }),
        {
          id: "disabled-app",
          displayName: "Disabled App",
          description: "Deliberately disabled.",
          slug: "disabled-app",
          enabled: false,
          repoPath: "disabled-app",
          adapterPath: "index.ts",
          contractVersion: 1,
          sortOrder: 3,
        },
      ],
    });

    const dashboard = fakeDashboard();
    let started: StartedHomeBase | undefined;
    try {
      started = await startServer({
        config: {
          projectRoot: fixture.projectRoot,
          environment: {
            HOMEBASE_WORKSPACE_PATH: fixtureAdaptersWorkspaceRoot,
            HOMEBASE_DATA_PATH: fixture.dataRoot,
          },
          nodeVersion: "24.0.0",
        },
        initializeDashboard: dashboard.initializeDashboard,
        listen: vi.fn(async () => undefined),
      });

      const listing = await request(started.app).get("/api/applications");
      expect(listing.status).toBe(200);
      expect(listing.body).toEqual([
        expect.objectContaining({ id: "routes-app", state: "ready" }),
        expect.objectContaining({ id: "static-app", state: "ready" }),
        expect.objectContaining({ id: "disabled-app", state: "disabled" }),
      ]);

      const routesResponse = await request(started.app).get("/routes-app/ping");
      expect(routesResponse.status).toBe(200);
      expect(routesResponse.body.applicationId).toBe("routes-app");

      const staticResponse = await request(started.app).get("/static-app/index.html");
      expect(staticResponse.status).toBe(200);
      expect(staticResponse.text).toContain("static-assets fixture index");

      const health = await request(started.app).get("/health");
      expect(health.status).toBe(200);
      const ready = await request(started.app).get("/ready");
      expect(ready.status).toBe(200);
    } finally {
      await started?.close();
    }

    expect(dashboard.close).toHaveBeenCalledOnce();
  });

  it("still enforces the pre-existing ENABLED_ADAPTER_MISSING startup rejection", async () => {
    const fixture = await buildFixture();
    const repository = path.join(fixture.workspaceRoot, "broken-app");
    await mkdir(repository, { recursive: true });
    await fixture.writeRegistry({
      schemaVersion: 1,
      server: { port: 17000 },
      applications: [
        {
          id: "broken-app",
          displayName: "Broken App",
          description: "Enabled with a missing compiled adapter.",
          slug: "broken-app",
          enabled: true,
          repoPath: "broken-app",
          adapterPath: "dist/host/index.js",
          contractVersion: 1,
        },
      ],
    });

    await expect(
      startServer({
        config: {
          projectRoot: fixture.projectRoot,
          environment: {
            HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot,
            HOMEBASE_DATA_PATH: fixture.dataRoot,
          },
          nodeVersion: "24.0.0",
        },
        initializeDashboard: fakeDashboard().initializeDashboard,
        listen: vi.fn(async () => undefined),
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});
