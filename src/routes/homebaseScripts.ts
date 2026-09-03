import { Router } from "express";
import type { ConfigService } from "../services/ConfigService.js";
import type { PackageScriptsService } from "../services/PackageScriptsService.js";
import type { ScriptRunnerService } from "../services/ScriptRunnerService.js";

export function createHomebaseScriptsRouter(
  configService: ConfigService,
  packageScriptsService: PackageScriptsService,
  scriptRunnerService: ScriptRunnerService,
): Router {
  const router = Router();

  router.get("/applications/:id/scripts", async (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const result = await packageScriptsService.getScripts(application.repositoryRoot);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(result);
  });

  router.post("/applications/:id/scripts/:name/run", async (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const result = await scriptRunnerService.run(
      application.id,
      application.repositoryRoot,
      application.packageManager,
      request.params.name,
    );
    response.setHeader("Cache-Control", "no-store");
    if ("conflict" in result) {
      response.status(409).json({ error: "operation-in-progress", runId: result.runId });
      return;
    }
    if ("error" in result) {
      response.status(404).json({ error: result.error });
      return;
    }
    response.status(200).json(result);
  });

  router.post("/applications/:id/scripts/run/:runId/stop", async (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const run = scriptRunnerService.getRun(request.params.runId);
    if (run === undefined || run.applicationId !== application.id) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const result = await scriptRunnerService.stop(request.params.runId);
    response.setHeader("Cache-Control", "no-store");
    if ("error" in result) {
      response.status(404).json({ error: result.error });
      return;
    }
    response.status(200).json({ ok: true });
  });

  router.get("/applications/:id/scripts/run/current", (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const run = scriptRunnerService.getCurrentRun(application.id);
    response.setHeader("Cache-Control", "no-store");
    if (run === undefined) {
      response.status(404).json({ error: "no-active-run" });
      return;
    }
    response.status(200).json(run);
  });

  router.get("/applications/:id/scripts/run/:runId", (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const run = scriptRunnerService.getRun(request.params.runId);
    response.setHeader("Cache-Control", "no-store");
    if (run === undefined || run.applicationId !== application.id) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    response.status(200).json(run);
  });

  return router;
}
