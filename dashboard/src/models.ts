export type ApplicationViewState =
  | "disabled"
  | "loading"
  | "initializing"
  | "ready"
  | "degraded"
  | "unavailable"
  | "stopping";

export interface DashboardApplication {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly basePath: `/${string}/`;
  readonly state: ApplicationViewState;
  readonly statusSummary: string;
}

export interface DashboardDataSource {
  listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]>;
}
