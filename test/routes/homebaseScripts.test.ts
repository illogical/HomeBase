import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ApplicationHost } from "../../src/services/ApplicationHost.js";
import { ConfigService } from "../../src/services/ConfigService.js";
import { createTestLogger } from "../support/testLogger.js";
import { createConfigFixture, validRegistry } from "../support/configFixture.js";

async function buildApp(
  fixture: Awaited<ReturnType<typeof createConfigFixture>>,
): Promise<ReturnType<typeof createApp>["app"]> {
  const configService = await ConfigService.load({
    projectRoot: fixture.projectRoot,
    environment: {
      HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot,
      HOMEBASE_DATA_PATH: fixture.dataRoot,
    },
    nodeVersion: "24.0.0",
  });
  const applicationHost = await ApplicationHost.loadAll(configService, createTestLogger());
  return createApp(configService, applicationHost).app;
}

async function writePackageJson(dir: string, scripts: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts }), "utf8");
}

describe("/api/homebase scripts routes", () => {
  it("returns 404 for an unknown application id when listing scripts", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const app = await buildApp(fixture);

      const response = await request(app).get("/api/homebase/applications/does-not-exist/scripts");

      expect(response.status).toBe(404);
    } finally {
      await fixture.cleanup();
    }
  });

  it("lists the scripts declared in the application's package.json", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      await writePackageJson(path.join(fixture.workspaceRoot, "FirstApp"), {
        build: "tsc",
        lint: "eslint .",
      });
      const app = await buildApp(fixture);

      const response = await request(app).get("/api/homebase/applications/first-app/scripts");

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.scripts).toEqual({ build: "tsc", lint: "eslint ." });
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns no-package-json when the repository has none", async () => {
    const fixture = await createConfigFixture();
    try {
      const registry = validRegistry();
      await fixture.writeRegistry(registry);
      await mkdir(path.join(fixture.workspaceRoot, "FirstApp"), { recursive: true });
      const app = await buildApp(fixture);

      const response = await request(app).get("/api/homebase/applications/first-app/scripts");

      expect(response.status).toBe(200);
      expect(response.body.error).toBe("no-package-json");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects running a script that is not declared in package.json", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      await writePackageJson(path.join(fixture.workspaceRoot, "FirstApp"), { build: "tsc" });
      const app = await buildApp(fixture);

      const response = await request(app).post(
        "/api/homebase/applications/first-app/scripts/not-declared/run",
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("unknown-script");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns 404 for an unknown application id when starting a run", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const app = await buildApp(fixture);

      const response = await request(app).post(
        "/api/homebase/applications/does-not-exist/scripts/build/run",
      );

      expect(response.status).toBe(404);
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports no active run for an application that has never run a script", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const app = await buildApp(fixture);

      const response = await request(app).get(
        "/api/homebase/applications/first-app/scripts/run/current",
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("no-active-run");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns 404 stopping an unknown run id", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const app = await buildApp(fixture);

      const response = await request(app).post(
        "/api/homebase/applications/first-app/scripts/run/00000000-0000-0000-0000-000000000000/stop",
      );

      expect(response.status).toBe(404);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not leak one application's run into another application's lookup", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      await writePackageJson(path.join(fixture.workspaceRoot, "FirstApp"), { build: "tsc" });
      const app = await buildApp(fixture);

      const started = await request(app).post("/api/homebase/applications/first-app/scripts/build/run");
      expect(started.status).toBe(200);
      const runId = started.body.runId as string;

      const crossAppLookup = await request(app).get(
        `/api/homebase/applications/second-app/scripts/run/${runId}`,
      );
      expect(crossAppLookup.status).toBe(404);
    } finally {
      await fixture.cleanup();
    }
  });

  // Actually spawning `npm run <script>` requires a POSIX process-group-capable
  // environment (this feature is only specified to run inside the Linux dev
  // container); `npm` resolves through a `.cmd` shim on native Windows that
  // Node's non-shell spawn cannot execute, so this is skipped there.
  it.skipIf(process.platform === "win32")(
    "runs a script end to end, streaming completion and rejecting a concurrent run",
    async () => {
      const fixture = await createConfigFixture();
      try {
        await fixture.writeRegistry(validRegistry());
        await writePackageJson(path.join(fixture.workspaceRoot, "FirstApp"), {
          build: "node -e \"console.log('hi'); process.exit(0)\"",
        });
        const app = await buildApp(fixture);

        const started = await request(app).post("/api/homebase/applications/first-app/scripts/build/run");
        expect(started.status).toBe(200);
        const runId = started.body.runId as string;

        const conflict = await request(app).post("/api/homebase/applications/first-app/scripts/build/run");
        expect(conflict.status).toBe(409);
        expect(conflict.body.runId).toBe(runId);

        await new Promise((resolve) => setTimeout(resolve, 1500));

        const current = await request(app).get(
          "/api/homebase/applications/first-app/scripts/run/current",
        );
        expect(current.status).toBe(200);
        expect(current.body.status).toBe("exited");
        expect(current.body.exitCode).toBe(0);
        expect(current.body.output.map((chunk: { data: string }) => chunk.data).join("")).toContain("hi");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "stops a long-running script and kills its process group",
    async () => {
      const fixture = await createConfigFixture();
      try {
        await fixture.writeRegistry(validRegistry());
        await writePackageJson(path.join(fixture.workspaceRoot, "FirstApp"), {
          dev: "node -e \"setInterval(() => {}, 1000)\"",
        });
        const app = await buildApp(fixture);

        const started = await request(app).post("/api/homebase/applications/first-app/scripts/dev/run");
        expect(started.status).toBe(200);
        const runId = started.body.runId as string;

        await new Promise((resolve) => setTimeout(resolve, 500));

        const stop = await request(app).post(
          `/api/homebase/applications/first-app/scripts/run/${runId}/stop`,
        );
        expect(stop.status).toBe(200);

        await new Promise((resolve) => setTimeout(resolve, 500));

        const current = await request(app).get(
          "/api/homebase/applications/first-app/scripts/run/current",
        );
        expect(current.body.status).toBe("killed");
      } finally {
        await fixture.cleanup();
      }
    },
  );
});
