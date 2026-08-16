import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { ConfigurationError } from "../src/config/ConfigurationError.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { startServer } from "../src/startServer.js";
import { createConfigFixture, validRegistry } from "./support/configFixture.js";

describe("server composition", () => {
  it("injects the same initialized ConfigService into the Express application", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
        nodeVersion: "24.0.0",
      });
      const app = createApp(configService);
      expect(app.locals.configService).toBe(configService);
    } finally {
      await fixture.cleanup();
    }
  });

  it("loads configuration before listening and listens exactly once", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
        nodeVersion: "24.0.0",
      });
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

  it("closes dashboard resources when listening fails", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
        nodeVersion: "24.0.0",
      });
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
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
        nodeVersion: "24.0.0",
      });
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
            environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
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
});
