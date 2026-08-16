import type { Server } from "node:http";
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
      const fakeServer = {} as Server;
      const listen = vi.fn(async () => fakeServer);

      const started = await startServer({ loadConfiguration, listen });

      expect(loadConfiguration).toHaveBeenCalledOnce();
      expect(listen).toHaveBeenCalledOnce();
      expect(listen).toHaveBeenCalledWith(started.app, 17000);
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
    const listen = vi.fn();

    await expect(startServer({ loadConfiguration, listen })).rejects.toBe(failure);
    expect(listen).not.toHaveBeenCalled();
  });

  it("does not listen when the real configuration service rejects the registry", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry({ ...validRegistry(), schemaVersion: 2 });
      const listen = vi.fn();

      await expect(
        startServer({
          config: {
            projectRoot: fixture.projectRoot,
            environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
            nodeVersion: "24.0.0",
          },
          listen,
        }),
      ).rejects.toBeInstanceOf(ConfigurationError);
      expect(listen).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });
});
