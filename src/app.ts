import express, { type Express } from "express";
import { requestIdMiddleware } from "./logging/requestContext.js";
import { createApplicationsRouter } from "./routes/applications.js";
import { createHealthRouter } from "./routes/health.js";
import { createHomebaseGitRouter } from "./routes/homebaseGit.js";
import { createHomebaseScriptsRouter } from "./routes/homebaseScripts.js";
import type { ApplicationHost } from "./services/ApplicationHost.js";
import type { ConfigService } from "./services/ConfigService.js";
import { GitStatusService } from "./services/GitStatusService.js";
import { PackageScriptsService } from "./services/PackageScriptsService.js";
import { ScriptRunnerService } from "./services/ScriptRunnerService.js";

export interface CreatedApp {
  readonly app: Express;
  readonly scriptRunnerService: ScriptRunnerService;
}

export function createApp(configService: ConfigService, applicationHost: ApplicationHost): CreatedApp {
  const app = express();
  app.locals.configService = configService;
  app.use(requestIdMiddleware());
  app.use("/api", createApplicationsRouter(configService, applicationHost));
  app.use("/api/homebase", createHomebaseGitRouter(configService, new GitStatusService()));
  const packageScriptsService = new PackageScriptsService();
  const scriptRunnerService = new ScriptRunnerService(packageScriptsService);
  app.use(
    "/api/homebase",
    createHomebaseScriptsRouter(configService, packageScriptsService, scriptRunnerService),
  );
  app.use(createHealthRouter());
  applicationHost.mountAll(app);
  return { app, scriptRunnerService };
}
