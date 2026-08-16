import { createServer as createHttpServer, type Server } from "node:http";
import type { Express } from "express";
import { createApp } from "./app.js";
import {
  initializeDashboard,
  type DashboardController,
  type DashboardMode,
  type InitializeDashboardOptions,
} from "./dashboardHost.js";
import type { ApplicationLogger } from "./contracts/hostedApplication.js";
import { RootLogger } from "./logging/RootLogger.js";
import { ApplicationHost } from "./services/ApplicationHost.js";
import { ConfigService, type ConfigServiceLoadOptions } from "./services/ConfigService.js";

export interface StartServerOptions {
  readonly config?: ConfigServiceLoadOptions;
  readonly loadConfiguration?: (
    options?: ConfigServiceLoadOptions,
  ) => Promise<ConfigService>;
  readonly createRootLogger?: (configService: ConfigService) => ApplicationLogger;
  readonly loadApplicationHost?: (
    configService: ConfigService,
    rootLogger: ApplicationLogger,
  ) => Promise<ApplicationHost>;
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
  readonly applicationHost: ApplicationHost;
  close(): Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedHomeBase> {
  const loadConfiguration = options.loadConfiguration ?? ConfigService.load;
  const configService = await loadConfiguration(options.config);
  const createRootLogger =
    options.createRootLogger ?? ((service: ConfigService) => RootLogger.create({ dataRoot: service.dataRoot }));
  const rootLogger = createRootLogger(configService);
  const loadApplicationHost = options.loadApplicationHost ?? ApplicationHost.loadAll;
  const applicationHost = await loadApplicationHost(configService, rootLogger);

  const app = createApp(configService, applicationHost);
  const server = (options.createServer ?? createHttpServer)(app);
  await applicationHost.attachRealtime(server);

  const mode = options.mode ?? "production";
  const prepareDashboard = options.initializeDashboard ?? initializeDashboard;
  let dashboard: DashboardController;
  try {
    dashboard = await prepareDashboard(app, server, { ...options.dashboard, mode });
  } catch (error) {
    await applicationHost.shutdown();
    throw error;
  }

  const listen = options.listen ?? listenWithExpress;
  let closePromise: Promise<void> | undefined;
  const close = async (): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      await applicationHost.shutdown();
      await dashboard.close();
    })();
    return closePromise;
  };

  try {
    await listen(server, configService.server.port);
    return { app, configService, server, applicationHost, close };
  } catch (error) {
    await applicationHost.shutdown();
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
