import express, { type Express } from "express";
import type { ConfigService } from "./services/ConfigService.js";

export function createApp(configService: ConfigService): Express {
  const app = express();
  app.locals.configService = configService;
  return app;
}
