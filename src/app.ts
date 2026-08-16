import express, { type Express } from "express";
import { requestIdMiddleware } from "./logging/requestContext.js";
import { createApplicationsRouter } from "./routes/applications.js";
import { createHealthRouter } from "./routes/health.js";
import type { ApplicationHost } from "./services/ApplicationHost.js";
import type { ConfigService } from "./services/ConfigService.js";

export function createApp(configService: ConfigService, applicationHost: ApplicationHost): Express {
  const app = express();
  app.locals.configService = configService;
  app.use(requestIdMiddleware());
  app.use("/api", createApplicationsRouter(configService, applicationHost));
  app.use(createHealthRouter());
  applicationHost.mountAll(app);
  return app;
}
