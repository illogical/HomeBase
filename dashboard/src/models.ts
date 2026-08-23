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

export type WorkingTreeState = "clean" | "dirty" | "unknown";

export type GitStatusError =
  | "not-a-git-repository"
  | "no-upstream"
  | "detached-head"
  | "git-not-installed";

export type GitMutationError =
  | GitStatusError
  | "dirty-tree"
  | "non-fast-forward"
  | "network-error"
  | "timeout"
  | "operation-in-progress";

export interface GitStatus {
  readonly branch: string | null;
  readonly commit: string | null;
  readonly workingTree: WorkingTreeState;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly checkedAt: string;
  readonly error?: GitStatusError | GitMutationError;
}

export interface GitMutationResult extends GitStatus {
  readonly pulled: boolean;
}

export interface DashboardDataSource {
  listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]>;
  getGitStatus(applicationId: string, signal?: AbortSignal): Promise<GitStatus>;
  fetchGit(applicationId: string, signal?: AbortSignal): Promise<GitStatus>;
  pullGit(applicationId: string, signal?: AbortSignal): Promise<GitMutationResult>;
}
