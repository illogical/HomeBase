import { Router } from "express";
import type { ApplicationLifecycleState } from "../contracts/hostedApplication.js";
import type { ApplicationConfiguration } from "../config/models.js";
import type { ApplicationHost } from "../services/ApplicationHost.js";
import type { ConfigService } from "../services/ConfigService.js";

export type ApplicationListingState = ApplicationLifecycleState;

export interface ApplicationListingEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly basePath: string;
  readonly state: ApplicationListingState;
  readonly statusSummary: string;
}

export function createApplicationsRouter(
  configService: ConfigService,
  applicationHost: ApplicationHost,
): Router {
  const router = Router();

  router.get("/applications", async (_request, response) => {
    const applications = [...configService.applications].sort(compareApplications);
    const entries = await Promise.all(
      applications.map((application) => toListingEntry(application, applicationHost)),
    );

    response.type("application/json");
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(entries);
  });

  router.post("/applications/:id/retry", async (request, response) => {
    const accepted = applicationHost.retry(request.params.id);
    if (!accepted) {
      response.status(409).json({ error: "not-retryable" });
      return;
    }

    const { state, summary } = await applicationHost.statusFor(request.params.id);
    response.setHeader("Cache-Control", "no-store");
    response.status(202).json({ state, statusSummary: summary });
  });

  // Development hot reload: re-imports the application's compiled adapter and
  // swaps the live instance. Unlike retry this is allowed from "loaded", and it
  // responds only once the swap has settled, so a caller (the dev watcher, or a
  // developer with curl) learns whether the new adapter actually came up.
  router.post("/applications/:id/reload", async (request, response) => {
    const outcome = await applicationHost.reload(request.params.id);
    response.setHeader("Cache-Control", "no-store");
    if (!outcome.ok) {
      response.status(outcome.reason === "unknown" ? 404 : 409).json({ error: outcome.reason });
      return;
    }
    response.status(200).json({ state: outcome.state, statusSummary: outcome.summary });
  });

  return router;
}

function compareApplications(
  left: ApplicationConfiguration,
  right: ApplicationConfiguration,
): number {
  const leftOrder = left.sortOrder ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.sortOrder ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.displayName.localeCompare(right.displayName);
}

async function toListingEntry(
  application: ApplicationConfiguration,
  applicationHost: ApplicationHost,
): Promise<ApplicationListingEntry> {
  const { state, summary } = await applicationHost.statusFor(application.id);
  return {
    id: application.id,
    displayName: application.displayName,
    description: application.description,
    basePath: application.basePath,
    state,
    statusSummary: summary,
  };
}
