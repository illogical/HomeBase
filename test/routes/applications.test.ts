import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ConfigService } from "../../src/services/ConfigService.js";
import { createConfigFixture, validRegistry } from "../support/configFixture.js";

async function enableFirstApp(fixture: Awaited<ReturnType<typeof createConfigFixture>>): Promise<void> {
  const repository = path.join(fixture.workspaceRoot, "FirstApp");
  const adapter = path.join(repository, "dist/host/index.js");
  await mkdir(path.dirname(adapter), { recursive: true });
  await writeFile(adapter, "export {};", "utf8");
}

describe("GET /api/applications", () => {
  it("returns sanitized, sorted listing entries with no-store caching", async () => {
    const fixture = await createConfigFixture();
    try {
      const registry = validRegistry();
      registry.applications[0]!.enabled = true;
      await enableFirstApp(fixture);
      await fixture.writeRegistry(registry);
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
        nodeVersion: "24.0.0",
      });
      const app = createApp(configService);

      const response = await request(app).get("/api/applications");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual([
        {
          id: "second-app",
          displayName: "Second App",
          description: "The second configured application.",
          basePath: "/second-app/",
          state: "disabled",
          statusSummary: "This application is disabled in the HomeBase configuration.",
        },
        {
          id: "first-app",
          displayName: "First App",
          description: "The first configured application.",
          basePath: "/first-app/",
          state: "unavailable",
          statusSummary: "Hosted adapter loading is not implemented yet.",
        },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("never serializes private filesystem or adapter fields", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
        nodeVersion: "24.0.0",
      });
      const app = createApp(configService);

      const response = await request(app).get("/api/applications");

      const raw = JSON.stringify(response.body);
      for (const forbidden of ["repoPath", "repositoryRoot", "adapterPath", "adapterFile"]) {
        expect(raw).not.toContain(forbidden);
      }
      expect(raw).not.toContain(fixture.workspaceRoot.replace(/\\/g, "\\\\"));
    } finally {
      await fixture.cleanup();
    }
  });

  it("sorts entries without a sortOrder after those with one, then by display name", async () => {
    const fixture = await createConfigFixture();
    try {
      const registry = validRegistry();
      delete registry.applications[0]!.sortOrder;
      await fixture.writeRegistry(registry);
      const configService = await ConfigService.load({
        projectRoot: fixture.projectRoot,
        environment: { HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot },
        nodeVersion: "24.0.0",
      });
      const app = createApp(configService);

      const response = await request(app).get("/api/applications");

      expect(response.body.map((entry: { id: string }) => entry.id)).toEqual([
        "second-app",
        "first-app",
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
});
