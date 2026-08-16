import { createServer, type Server } from "node:http";
import express from "express";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RegistryApplication } from "../../src/config/models.js";
import { ApplicationHost } from "../../src/services/ApplicationHost.js";
import { ConfigService } from "../../src/services/ConfigService.js";
import { createConfigFixture, type ConfigFixture } from "../support/configFixture.js";
import {
  fixtureAdaptersWorkspaceRoot,
  fixtureApplication,
  type FixtureAdapterName,
} from "../support/fixtureAdapters.js";
import { createTestLogger } from "../support/testLogger.js";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((task) => task()));
});

async function buildFixture(): Promise<ConfigFixture> {
  const fixture = await createConfigFixture();
  cleanupTasks.push(fixture.cleanup);
  return fixture;
}

async function loadHost(
  fixture: ConfigFixture,
  entries: Array<{ id: string; adapter: FixtureAdapterName; overrides?: Partial<RegistryApplication> }>,
): Promise<{ host: ApplicationHost; logger: ReturnType<typeof createTestLogger> }> {
  const applications: RegistryApplication[] = entries.map((entry) =>
    fixtureApplication(entry.id, entry.adapter, entry.overrides),
  );
  await fixture.writeRegistry({ schemaVersion: 1, server: { port: 17000 }, applications });
  const configService = await ConfigService.load({
    projectRoot: fixture.projectRoot,
    environment: {
      HOMEBASE_WORKSPACE_PATH: fixtureAdaptersWorkspaceRoot,
      HOMEBASE_DATA_PATH: fixture.dataRoot,
    },
    nodeVersion: "24.0.0",
  });
  const logger = createTestLogger();
  const host = await ApplicationHost.loadAll(configService, logger);
  return { host, logger };
}

describe("ApplicationHost import safety", () => {
  it("performs no effects from import or the factory call, only from initialize/getStatus", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [{ id: "routes-app", adapter: "routes" }]);
    const { effects } = await import("../fixtures/adapters/routes/index.js");
    expect(effects).toEqual([]);

    const status = await host.statusFor("routes-app");
    expect(status.state).toBe("ready");
    expect(effects).toContain("getStatus");
  });
});

describe("ApplicationHost compatibility and failure handling", () => {
  it("treats a mismatched contractVersion as unavailable without calling initialize", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [
      { id: "bad-version-app", adapter: "bad-contract-version" },
    ]);
    const status = await host.statusFor("bad-version-app");
    expect(status.state).toBe("unavailable");
    const { effects } = await import("../fixtures/adapters/bad-contract-version/index.js");
    expect(effects).not.toContain("initialize");
  });

  it("marks a fixture unavailable without calling dispose when initialize throws", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [{ id: "failing-app", adapter: "failing" }]);
    const status = await host.statusFor("failing-app");
    expect(status.state).toBe("unavailable");

    const { effects } = await import("../fixtures/adapters/failing/index.js");
    expect(effects).toContain("acquire-handle");
    expect(effects).toContain("release-handle");
    expect(effects).not.toContain("dispose");

    await host.shutdown();
    expect(effects).not.toContain("dispose");
  });

  it("reports unavailable with a sanitized summary when the module throws on import", async () => {
    const fixture = await buildFixture();
    const { host, logger } = await loadHost(fixture, [
      { id: "throws-app", adapter: "throws-on-import" },
    ]);
    const status = await host.statusFor("throws-app");
    expect(status.state).toBe("unavailable");
    expect(status.summary).not.toContain("Simulated");
    expect(logger.entries.some((entry) => entry.event === "load-failed")).toBe(true);
  });

  it("reports unavailable when the module has no default export function", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [
      { id: "no-default-app", adapter: "no-default-export" },
    ]);
    const status = await host.statusFor("no-default-app");
    expect(status.state).toBe("unavailable");
  });
});

describe("ApplicationHost mounting and isolation", () => {
  it("never lets one fixture's content leak through another's base path", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [
      { id: "routes-app", adapter: "routes" },
      { id: "static-app", adapter: "static-assets" },
      { id: "spa-app", adapter: "spa-fallback" },
    ]);
    const app = express();
    host.mountAll(app);

    const ping = await request(app).get("/routes-app/ping");
    expect(ping.status).toBe(200);
    expect(ping.body.applicationId).toBe("routes-app");

    const staticIndex = await request(app).get("/static-app/index.html");
    expect(staticIndex.status).toBe(200);
    expect(staticIndex.text).toContain("static-assets fixture index");

    const staticAsset = await request(app).get("/static-app/nested/asset.txt");
    expect(staticAsset.status).toBe(200);
    expect(staticAsset.text).toContain("static-assets fixture nested asset");

    const staticMiss = await request(app).get("/static-app/does-not-exist");
    expect(staticMiss.status).toBe(404);

    const spaUnmatched = await request(app).get("/spa-app/some/deep/route");
    expect(spaUnmatched.status).toBe(200);
    expect(spaUnmatched.text).toContain("spa-fallback fixture index");

    const spaNeverStatic = await request(app).get("/spa-app/nested/asset.txt");
    expect(spaNeverStatic.status).toBe(200);
    expect(spaNeverStatic.text).toContain("spa-fallback fixture index");
  });

  it("308-redirects a bare slug request to its trailing-slash base path", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [{ id: "routes-app", adapter: "routes" }]);
    const app = express();
    host.mountAll(app);

    const response = await request(app).get("/routes-app").redirects(0);
    expect(response.status).toBe(308);
    expect(response.headers.location).toBe("/routes-app/");
  });

  it("does not redirect an already-canonical trailing-slash request", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [{ id: "static-app", adapter: "static-assets" }]);
    const app = express();
    host.mountAll(app);

    const response = await request(app).get("/static-app/").redirects(0);
    expect(response.status).toBe(200);
    expect(response.text).toContain("static-assets fixture index");
  });

  it("returns a scoped 503 with sanitized state for an unavailable application", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [{ id: "throws-app", adapter: "throws-on-import" }]);
    const app = express();
    host.mountAll(app);

    const response = await request(app).get("/throws-app/anything");
    expect(response.status).toBe(503);
    expect(response.body.state).toBe("unavailable");
    expect(JSON.stringify(response.body)).not.toContain("Simulated");
  });
});

async function withHttpServer(app: express.Express): Promise<{ server: Server; port: number }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a network address.");
  }
  return { server, port: address.port };
}

describe("ApplicationHost realtime isolation", () => {
  it("lets a WebSocket and Socket.IO client each reach only their own fixture, regardless of attach order", async () => {
    for (const order of [
      ["websocket-app", "socketio-app"],
      ["socketio-app", "websocket-app"],
    ] as const) {
      const fixture = await buildFixture();
      const { host } = await loadHost(fixture, [
        { id: "websocket-app", adapter: "websocket" },
        { id: "socketio-app", adapter: "socket-io" },
      ]);
      const app = express();
      host.mountAll(app);
      const { server, port } = await withHttpServer(app);
      cleanupTasks.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

      void order;
      await host.attachRealtime(server);

      const { counters: wsCounters } = await import("../fixtures/adapters/websocket/index.js");
      const { counters: ioCounters } = await import("../fixtures/adapters/socket-io/index.js");
      wsCounters.connections = 0;
      ioCounters.connections = 0;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket-app/socket`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(wsCounters.connections).toBe(1);
      expect(ioCounters.connections).toBe(0);
      ws.close();

      const socket: ClientSocket = ioClient(`http://127.0.0.1:${port}`, {
        path: "/socketio-app/socket.io",
        transports: ["websocket"],
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ioCounters.connections).toBe(1);
      expect(wsCounters.connections).toBe(0);
      socket.close();

      await host.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);
});

describe("ApplicationHost status honesty", () => {
  it("reports degraded consistently and never falsifies a healthy sibling's status", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [
      { id: "degraded-app", adapter: "degraded" },
      { id: "throwing-app", adapter: "throwing-status" },
      { id: "routes-app", adapter: "routes" },
    ]);

    const degraded = await host.statusFor("degraded-app");
    expect(degraded.state).toBe("degraded");

    const throwing = await host.statusFor("throwing-app");
    expect(throwing.state).toBe("degraded");
    expect(throwing.summary).not.toContain("Simulated");

    const healthy = await host.statusFor("routes-app");
    expect(healthy.state).toBe("ready");
  });
});

describe("ApplicationHost shutdown", () => {
  it("honors the active-work grace window and still completes shutdown", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [{ id: "active-work-app", adapter: "active-work" }]);
    const { scheduleActiveWork } = await import("../fixtures/adapters/active-work/index.js");
    scheduleActiveWork(200);

    const started = Date.now();
    await host.shutdown();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4900);
    expect(elapsed).toBeLessThan(19000);
  }, 20000);

  it("disposes the cleanup fixture exactly once even if shutdown is invoked twice", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [{ id: "cleanup-app", adapter: "cleanup" }]);
    const { effects } = await import("../fixtures/adapters/cleanup/index.js");

    await Promise.all([host.shutdown(), host.shutdown()]);

    expect(effects.filter((entry) => entry === "cleanup-app:dispose")).toHaveLength(1);
  });

  it("does not let one hung disposal block a sibling's disposal", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [
      { id: "hanging-app", adapter: "hanging-dispose" },
      { id: "cleanup-app", adapter: "cleanup" },
    ]);
    const { effects: hangingEffects } = await import("../fixtures/adapters/hanging-dispose/index.js");
    const { effects: cleanupEffects } = await import("../fixtures/adapters/cleanup/index.js");

    const started = Date.now();
    await host.shutdown();
    const elapsed = Date.now() - started;

    expect(hangingEffects).toContain("dispose-start");
    expect(cleanupEffects).toContain("cleanup-app:dispose");
    expect(elapsed).toBeLessThan(19000);
  }, 20000);

  it("disposes loaded applications in reverse registry order", async () => {
    const fixture = await buildFixture();
    const { host } = await loadHost(fixture, [
      { id: "first-cleanup", adapter: "cleanup" },
      { id: "second-cleanup", adapter: "cleanup" },
    ]);
    const { effects } = await import("../fixtures/adapters/cleanup/index.js");

    await host.shutdown();

    const disposeOrder = effects.filter((entry) => entry.endsWith(":dispose"));
    const firstIndex = disposeOrder.indexOf("first-cleanup:dispose");
    const secondIndex = disposeOrder.indexOf("second-cleanup:dispose");
    expect(secondIndex).toBeLessThan(firstIndex);
  });
});
