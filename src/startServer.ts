import type { Server } from "node:http";
import type { Express } from "express";
import { createApp } from "./app.js";
import { ConfigService, type ConfigServiceLoadOptions } from "./services/ConfigService.js";

export interface StartServerOptions {
  readonly config?: ConfigServiceLoadOptions;
  readonly loadConfiguration?: (
    options?: ConfigServiceLoadOptions,
  ) => Promise<ConfigService>;
  readonly listen?: (app: Express, port: number) => Promise<Server>;
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
  const listen = options.listen ?? listenWithExpress;
  const server = await listen(app, configService.server.port);
  return { app, configService, server };
}

function listenWithExpress(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.once("error", reject);
  });
}
