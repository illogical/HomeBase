import { createServer as createHttpServer, type Server } from "node:http";
import type { Express } from "express";
import { createApp } from "./app.js";
import {
  initializeDashboard,
  type DashboardController,
  type DashboardMode,
  type InitializeDashboardOptions,
} from "./dashboardHost.js";
import { ConfigService, type ConfigServiceLoadOptions } from "./services/ConfigService.js";

export interface StartServerOptions {
  readonly config?: ConfigServiceLoadOptions;
  readonly loadConfiguration?: (
    options?: ConfigServiceLoadOptions,
  ) => Promise<ConfigService>;
  readonly mode?: DashboardMode;
  readonly createServer?: (app: Express) => Server;
  readonly initializeDashboard?: (
    app: Express,
    server: Server,
    options: InitializeDashboardOptions,
  ) => Promise<DashboardController>;
  readonly dashboard?: Omit<InitializeDashboardOptions, "mode">;
  readonly listen?: (server: Server, port: number) => Promise<void>;
}

export interface StartedHomeBase {
  readonly app: Express;
  readonly configService: ConfigService;
  readonly server: Server;
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedHomeBase> {
  const loadConfiguration = options.loadConfiguration ?? ConfigService.load;
  const configService = await loadConfiguration(options.config);
  const app = createApp(configService);
  const server = (options.createServer ?? createHttpServer)(app);
  const mode = options.mode ?? "production";
  const prepareDashboard = options.initializeDashboard ?? initializeDashboard;
  const dashboard = await prepareDashboard(app, server, { ...options.dashboard, mode });
  const listen = options.listen ?? listenWithExpress;
  try {
    await listen(server, configService.server.port);
    return { app, configService, server };
  } catch (error) {
    await dashboard.close();
    throw error;
  }
}

function listenWithExpress(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port);
  });
}
