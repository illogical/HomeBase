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
