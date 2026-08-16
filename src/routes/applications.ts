import { Router } from "express";
import type { ApplicationConfiguration } from "../config/models.js";
import type { ConfigService } from "../services/ConfigService.js";

export type ApplicationListingState = "disabled" | "unavailable";

export interface ApplicationListingEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly basePath: string;
  readonly state: ApplicationListingState;
  readonly statusSummary: string;
}

export function createApplicationsRouter(configService: ConfigService): Router {
  const router = Router();

  router.get("/applications", (_request, response) => {
    const entries = [...configService.applications]
      .sort(compareApplications)
      .map(toListingEntry);

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

function toListingEntry(application: ApplicationConfiguration): ApplicationListingEntry {
  return {
    id: application.id,
    displayName: application.displayName,
    description: application.description,
    basePath: application.basePath,
    state: application.enabled ? "unavailable" : "disabled",
    statusSummary: application.enabled
      ? "Hosted adapter loading is not implemented yet."
      : "This application is disabled in the HomeBase configuration.",
  };
}
