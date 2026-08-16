import { readFile, stat } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { InlineConfig, ViteDevServer } from "vite";

export type DashboardMode = "development" | "production";

export interface DashboardController {
  close(): Promise<void>;
}

export interface InitializeDashboardOptions {
  readonly mode: DashboardMode;
  readonly projectRoot?: string;
  readonly createViteServer?: (config: InlineConfig) => Promise<ViteDevServer>;
}

export class DashboardInitializationError extends Error {
  constructor(cause?: unknown) {
    super("HomeBase dashboard could not be initialized.", { cause });
    this.name = "DashboardInitializationError";
  }
}

const defaultProjectRoot = fileURLToPath(new URL("../", import.meta.url));
const immutableAssetName = /^\/[a-zA-Z0-9][a-zA-Z0-9._-]*-[a-zA-Z0-9_-]{6,}\.[a-zA-Z0-9]+$/;

export async function initializeDashboard(
  app: Express,
  server: Server,
  options: InitializeDashboardOptions,
): Promise<DashboardController> {
  try {
    const projectRoot = options.projectRoot ?? defaultProjectRoot;
    return options.mode === "development"
      ? await initializeDevelopmentDashboard(app, server, projectRoot, options.createViteServer)
      : await initializeProductionDashboard(app, projectRoot);
  } catch (error) {
    if (error instanceof DashboardInitializationError) {
      throw error;
    }
    throw new DashboardInitializationError(error);
  }
}

async function initializeDevelopmentDashboard(
  app: Express,
  server: Server,
  projectRoot: string,
  createViteServer?: (config: InlineConfig) => Promise<ViteDevServer>,
): Promise<DashboardController> {
  const dashboardRoot = join(projectRoot, "dashboard");
  const indexPath = join(dashboardRoot, "index.html");
  const indexTemplate = await readFile(indexPath, "utf8");
  const createVite = createViteServer ?? (await import("vite")).createServer;
  const vite = await createVite({
    root: dashboardRoot,
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: { server },
    },
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    server.off("close", closeOnServerClose);
    await vite.close();
  };
  const closeOnServerClose = (): void => {
    void close();
  };

  server.once("close", closeOnServerClose);
  app.use(vite.middlewares);
  app.get("/", async (request, response, next) => {
    try {
      const html = await vite.transformIndexHtml(request.originalUrl, indexTemplate);
      setHtmlHeaders(response);
      response.status(200).send(html);
    } catch (error) {
      next(error);
    }
  });

  return { close };
}

async function initializeProductionDashboard(
  app: Express,
  projectRoot: string,
): Promise<DashboardController> {
  const dashboardRoot = join(projectRoot, "dist", "dashboard");
  const indexPath = join(dashboardRoot, "index.html");
  const assetsRoot = join(dashboardRoot, "assets");

  const [indexDetails, assetDetails, html] = await Promise.all([
    stat(indexPath),
    stat(assetsRoot),
    readFile(indexPath, "utf8"),
  ]);

  if (!indexDetails.isFile() || !assetDetails.isDirectory()) {
    throw new DashboardInitializationError();
  }

  app.use(
    "/assets",
    (request: Request, response: Response, next: NextFunction) => {
      if (!immutableAssetName.test(request.path)) {
        response.status(404).type("text/plain").send("Not found.");
        return;
      }
      next();
    },
    express.static(assetsRoot, {
      dotfiles: "deny",
      fallthrough: true,
      immutable: true,
      index: false,
      maxAge: "1y",
      redirect: false,
      setHeaders(response) {
        response.setHeader("X-Content-Type-Options", "nosniff");
      },
    }),
    (_request: Request, response: Response) => {
      response.status(404).type("text/plain").send("Not found.");
    },
  );

  app.get("/", (_request, response) => {
    setHtmlHeaders(response);
    response.status(200).send(html);
  });

  return { close: async () => undefined };
}

function setHtmlHeaders(response: Response): void {
  response.type("html");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
}
