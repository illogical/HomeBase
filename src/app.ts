import express, { type Express } from "express";
import { createApplicationsRouter } from "./routes/applications.js";
import { createHealthRouter } from "./routes/health.js";
import type { ConfigService } from "./services/ConfigService.js";

export function createApp(configService: ConfigService): Express {
  const app = express();
  app.locals.configService = configService;
  app.use("/api", createApplicationsRouter(configService));
  app.use(createHealthRouter());
  return app;
}
