import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ApplicationHost } from "../../src/services/ApplicationHost.js";
import { ConfigService } from "../../src/services/ConfigService.js";
import { createConfigFixture, validRegistry } from "../support/configFixture.js";
import { createTestLogger } from "../support/testLogger.js";

describe("liveness and readiness", () => {
  it("returns minimal 200 bodies with no configuration or path detail", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: {
          HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot,
          HOMEBASE_DATA_PATH: fixture.dataRoot,
        },
        nodeVersion: "24.0.0",
      });
      const applicationHost = await ApplicationHost.loadAll(configService, createTestLogger());
      const app = createApp(configService, applicationHost);

      const health = await request(app).get("/health");
      expect(health.status).toBe(200);
      expect(health.body).toEqual({ status: "ok" });

      const ready = await request(app).get("/ready");
      expect(ready.status).toBe(200);
      expect(ready.body).toEqual({ status: "ready" });

      const raw = `${JSON.stringify(health.body)}${JSON.stringify(ready.body)}`;
      expect(raw).not.toContain(fixture.workspaceRoot.replace(/\\/g, "\\\\"));
    } finally {
      await fixture.cleanup();
    }
  });
});
