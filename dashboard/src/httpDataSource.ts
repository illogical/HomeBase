import type { ApplicationViewState, DashboardApplication, DashboardDataSource } from "./models";

const knownStates: ReadonlySet<ApplicationViewState> = new Set([
  "disabled",
  "loading",
  "initializing",
  "ready",
  "degraded",
  "unavailable",
  "stopping",
]);

export class HttpDashboardDataSource implements DashboardDataSource {
  async listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]> {
    const response = await fetch("/api/applications", { signal: signal ?? null });
    if (!response.ok) {
      throw new Error(`Application listing request failed with status ${response.status}.`);
    }
    const payload: unknown = await response.json();
    return parseApplicationListing(payload);
  }
}

function parseApplicationListing(payload: unknown): readonly DashboardApplication[] {
  if (!Array.isArray(payload)) {
    throw new Error("Application listing response was not an array.");
  }
  return Object.freeze(payload.map((entry) => Object.freeze(parseApplication(entry))));
}

function parseApplication(entry: unknown): DashboardApplication {
  if (typeof entry !== "object" || entry === null) {
    throw new Error("Application listing entry was not an object.");
  }
  const { id, displayName, description, basePath, state, statusSummary } = entry as Record<
    string,
    unknown
  >;

  if (
    typeof id !== "string" ||
    typeof displayName !== "string" ||
    typeof description !== "string" ||
    typeof statusSummary !== "string"
  ) {
    throw new Error("Application listing entry had a missing or malformed string field.");
  }
  if (typeof basePath !== "string" || !basePath.startsWith("/") || !basePath.endsWith("/")) {
    throw new Error("Application listing entry had a malformed basePath.");
  }
  if (typeof state !== "string" || !knownStates.has(state as ApplicationViewState)) {
    throw new Error("Application listing entry had an unknown state.");
  }

  return {
    id,
    displayName,
    description,
    basePath: basePath as `/${string}/`,
    state: state as ApplicationViewState,
    statusSummary,
  };
}
