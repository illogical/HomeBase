import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { ConfigurationError } from "../src/config/ConfigurationError.js";
import { ApplicationHost } from "../src/services/ApplicationHost.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { startServer } from "../src/startServer.js";
import { createConfigFixture, validRegistry } from "./support/configFixture.js";
import { createTestLogger } from "./support/testLogger.js";

async function loadRealConfigService(
  fixture: Awaited<ReturnType<typeof createConfigFixture>>,
): Promise<ConfigService> {
  return ConfigService.load({
    projectRoot: fixture.projectRoot,
    environment: {
      HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot,
      HOMEBASE_DATA_PATH: fixture.dataRoot,
    },
    nodeVersion: "24.0.0",
  });
}

describe("server composition", () => {
  it("injects the same initialized ConfigService into the Express application", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await loadRealConfigService(fixture);
      const applicationHost = await ApplicationHost.loadAll(configService, createTestLogger());
      const app = createApp(configService, applicationHost);
      expect(app.locals.configService).toBe(configService);
    } finally {
      await fixture.cleanup();
    }
  });

  it("loads configuration before listening and listens exactly once", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await loadRealConfigService(fixture);
      const loadConfiguration = vi.fn(async () => configService);
      const fakeServer = createServer();
      const createServerForTest = vi.fn(() => fakeServer);
      const closeDashboard = vi.fn(async () => undefined);
      const initializeDashboard = vi.fn(async () => ({ close: closeDashboard }));
      const listen = vi.fn(async () => undefined);

      const started = await startServer({
        loadConfiguration,
        createServer: createServerForTest,
        initializeDashboard,
        listen,
      });

      expect(loadConfiguration).toHaveBeenCalledOnce();
      expect(createServerForTest).toHaveBeenCalledWith(started.app);
      expect(initializeDashboard).toHaveBeenCalledWith(started.app, fakeServer, {
        mode: "production",
      });
      expect(listen).toHaveBeenCalledOnce();
      expect(listen).toHaveBeenCalledWith(fakeServer, 17000);
      expect(started.configService).toBe(configService);
      expect(started.server).toBe(fakeServer);

      await started.close();
      expect(closeDashboard).toHaveBeenCalledOnce();
    } finally {
      await fixture.cleanup();
    }
  });

  it("never creates a listener when configuration fails", async () => {
    const failure = new ConfigurationError([
      {
        code: "CONFIG_SCHEMA_INVALID",
        path: "/",
        message: "invalid test registry",
      },
    ]);
    const loadConfiguration = vi.fn(async () => Promise.reject(failure));
    const createServerForTest = vi.fn(() => ({}) as Server);
    const initializeDashboard = vi.fn();
    const listen = vi.fn();

    await expect(
      startServer({ loadConfiguration, createServer: createServerForTest, initializeDashboard, listen }),
    ).rejects.toBe(failure);
    expect(createServerForTest).not.toHaveBeenCalled();
    expect(initializeDashboard).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it("closes dashboard and application host resources when listening fails", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await loadRealConfigService(fixture);
      const failure = new Error("test listen failure");
      const close = vi.fn(async () => undefined);
      const initializeDashboard = vi.fn(async () => ({ close }));
      const fakeServer = createServer();

      await expect(
        startServer({
          loadConfiguration: vi.fn(async () => configService),
          createServer: () => fakeServer,
          initializeDashboard,
          listen: vi.fn(async () => Promise.reject(failure)),
        }),
      ).rejects.toBe(failure);
      expect(close).toHaveBeenCalledOnce();
      expect(fakeServer.listening).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not listen when dashboard initialization fails", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await loadRealConfigService(fixture);
      const failure = new Error("test dashboard failure");
      const listen = vi.fn();

      await expect(
        startServer({
          loadConfiguration: vi.fn(async () => configService),
          createServer,
          initializeDashboard: vi.fn(async () => Promise.reject(failure)),
          listen,
        }),
      ).rejects.toBe(failure);
      expect(listen).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not listen when the real configuration service rejects the registry", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry({ ...validRegistry(), schemaVersion: 2 });
      const initializeDashboard = vi.fn();
      const listen = vi.fn();

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
          initializeDashboard,
          listen,
        }),
      ).rejects.toBeInstanceOf(ConfigurationError);
      expect(listen).not.toHaveBeenCalled();
      expect(initializeDashboard).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("close() disposes the application host and dashboard exactly once", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await loadRealConfigService(fixture);
      const close = vi.fn(async () => undefined);
      const fakeServer = createServer();

      const started = await startServer({
        loadConfiguration: vi.fn(async () => configService),
        createServer: () => fakeServer,
        initializeDashboard: vi.fn(async () => ({ close })),
        listen: vi.fn(async () => undefined),
      });

      await started.close();
      await started.close();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      await fixture.cleanup();
    }
  });
});
