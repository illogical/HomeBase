import { Router } from "express";
import type { ConfigService } from "../services/ConfigService.js";
import type { GitStatusService } from "../services/GitStatusService.js";

export function createHomebaseGitRouter(
  configService: ConfigService,
  gitStatusService: GitStatusService,
): Router {
  const router = Router();

  router.get("/applications/:id/git-status", async (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const status = await gitStatusService.getStatus(application.id, application.repositoryRoot);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(status);
  });

  router.post("/applications/:id/git-status/fetch", async (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const result = await gitStatusService.fetch(application.id, application.repositoryRoot);
    response.setHeader("Cache-Control", "no-store");
    if ("conflict" in result) {
      response.status(409).json({ error: "operation-in-progress" });
      return;
    }
    response.status(200).json(result);
  });

  router.post("/applications/:id/git-status/pull", async (request, response) => {
    const application = configService.getApplication(request.params.id);
    if (!application) {
      response.status(404).json({ error: "not-found" });
      return;
    }
    const result = await gitStatusService.pull(application.id, application.repositoryRoot);
    response.setHeader("Cache-Control", "no-store");
    if ("conflict" in result) {
      response.status(409).json({ error: "operation-in-progress" });
      return;
    }
    if (result.error === "dirty-tree") {
      response.status(409).json(result);
      return;
    }
    response.status(200).json(result);
  });

  return router;
}
