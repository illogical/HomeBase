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

export type PackageScriptsError = "no-package-json" | "invalid-package-json" | "read-error";

export interface ScriptsResult {
  readonly scripts: Readonly<Record<string, string>>;
  readonly checkedAt: string;
  readonly error?: PackageScriptsError;
}

export type RunStatus = "running" | "exited" | "killed" | "error";

export interface OutputChunk {
  readonly seq: number;
  readonly stream: "stdout" | "stderr";
  readonly data: string;
  readonly timestamp: string;
}

export interface RunState {
  readonly runId: string;
  readonly applicationId: string;
  readonly scriptName: string;
  readonly status: RunStatus;
  readonly exitCode: number | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly output: readonly OutputChunk[];
}

export interface RunStarted {
  readonly runId: string;
  readonly startedAt: string;
}

export class RunOperationConflictError extends Error {
  constructor(public readonly runId: string) {
    super("A script is already running for this application.");
    this.name = "RunOperationConflictError";
  }
}

export interface DashboardDataSource {
  listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]>;
  retryApplication(applicationId: string, signal?: AbortSignal): Promise<void>;
  getGitStatus(applicationId: string, signal?: AbortSignal): Promise<GitStatus>;
  fetchGit(applicationId: string, signal?: AbortSignal): Promise<GitStatus>;
  pullGit(applicationId: string, signal?: AbortSignal): Promise<GitMutationResult>;
  listScripts(applicationId: string, signal?: AbortSignal): Promise<ScriptsResult>;
  runScript(applicationId: string, scriptName: string, signal?: AbortSignal): Promise<RunStarted>;
  stopScript(applicationId: string, runId: string, signal?: AbortSignal): Promise<void>;
  getCurrentRun(applicationId: string, signal?: AbortSignal): Promise<RunState | null>;
  getRunReplay(applicationId: string, runId: string, signal?: AbortSignal): Promise<RunState>;
  subscribeToRunOutput(
    runId: string,
    onOutput: (chunk: OutputChunk) => void,
    onStatus: (run: RunState) => void,
  ): () => void;
}
