import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DashboardInitializationError,
  initializeDashboard,
} from "../src/dashboardHost.js";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((path) => rm(path, { force: true, recursive: true })));
  temporaryDirectories.clear();
});

describe("dashboard hosting", () => {
  it("serves transformed development HTML from exact root and closes Vite with HTTP", async () => {
    const projectRoot = await createProjectRoot();
    await mkdir(join(projectRoot, "dashboard"));
    await writeFile(join(projectRoot, "dashboard", "index.html"), "<main>template</main>");
    const app = express();
    const server = trackedServer(app);
    const transformIndexHtml = vi.fn(async (_url: string, html: string) => `${html} transformed`);
    const close = vi.fn(async () => undefined);
    const createViteServer = vi.fn(async () => ({
      middlewares: (_request: unknown, _response: unknown, next: () => void) => next(),
      transformIndexHtml,
      close,
    })) as unknown as NonNullable<Parameters<typeof initializeDashboard>[2]["createViteServer"]>;

    await initializeDashboard(app, server, {
      mode: "development",
      projectRoot,
      createViteServer,
    });
    expect(createViteServer).toHaveBeenCalledWith({
      root: join(projectRoot, "dashboard"),
      appType: "custom",
      server: {
        middlewareMode: true,
        hmr: { server },
      },
    });
    const root = await request(app).get("/?fixture=empty");
    expect(root.text).toBe("<main>template</main> transformed");
    expect(transformIndexHtml).toHaveBeenCalledWith("/?fixture=empty", "<main>template</main>");
    expect((await request(app).get("/api")).status).toBe(404);

    server.emit("close");
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it("serves only production root HTML and hashed assets with safe headers", async () => {
    const projectRoot = await createProductionFixture();
    const app = express();
    const server = trackedServer(app);
    await initializeDashboard(app, server, { mode: "production", projectRoot });
    const root = await request(app).get("/");
    expect(root.status).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.headers["cache-control"]).toBe("no-cache");
    expect(root.headers["x-content-type-options"]).toBe("nosniff");
    expect(root.text).toContain("production dashboard");

    const asset = await request(app).get("/assets/index-abcdef12.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");
    expect(asset.text).toBe("console.log('fixture');");
  });

  it.each(["/api", "/health", "/ready", "/unknown", "/devplanner/"])(
    "does not serve dashboard HTML for %s",
    async (path) => {
      const projectRoot = await createProductionFixture();
      const app = express();
      const server = trackedServer(app);
      await initializeDashboard(app, server, { mode: "production", projectRoot });
      const response = await request(app).get(path);

      expect(response.status).toBe(404);
      expect(response.text).not.toContain("production dashboard");
    },
  );

  it.each(["/assets/source.js", "/assets/index-abcdef12.js.map", "/assets/%2e%2e/secret.txt"])(
    "does not expose non-build asset path %s",
    async (path) => {
      const projectRoot = await createProductionFixture();
      await writeFile(join(projectRoot, "dist", "dashboard", "secret.txt"), "secret");
      const app = express();
      const server = trackedServer(app);
      await initializeDashboard(app, server, { mode: "production", projectRoot });
      const response = await request(app).get(path);

      expect(response.status).toBe(404);
      expect(response.text).not.toBe("secret");
    },
  );

  it("rejects missing production output with a sanitized error", async () => {
    const projectRoot = await createProjectRoot();
    const app = express();
    const server = trackedServer(app);

    await expect(
      initializeDashboard(app, server, { mode: "production", projectRoot }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DashboardInitializationError>>({
        name: "DashboardInitializationError",
        message: "HomeBase dashboard could not be initialized.",
      }),
    );
    expect(server.listening).toBe(false);
  });
});

async function createProjectRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "homebase-dashboard-test-"));
  temporaryDirectories.add(path);
  return path;
}

async function createProductionFixture(): Promise<string> {
  const projectRoot = await createProjectRoot();
  const assets = join(projectRoot, "dist", "dashboard", "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(join(projectRoot, "dist", "dashboard", "index.html"), "<h1>production dashboard</h1>");
  await writeFile(join(assets, "index-abcdef12.js"), "console.log('fixture');");
  return projectRoot;
}

function trackedServer(app: Express): Server {
  return createServer(app);
}
