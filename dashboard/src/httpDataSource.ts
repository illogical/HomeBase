import type {
  ApplicationViewState,
  DashboardApplication,
  DashboardDataSource,
  GitMutationError,
  GitMutationResult,
  GitStatus,
  GitStatusError,
  WorkingTreeState,
} from "./models";

const knownStates: ReadonlySet<ApplicationViewState> = new Set([
  "disabled",
  "loading",
  "initializing",
  "ready",
  "degraded",
  "unavailable",
  "stopping",
]);

const knownWorkingTreeStates: ReadonlySet<WorkingTreeState> = new Set(["clean", "dirty", "unknown"]);

const knownGitErrors: ReadonlySet<string> = new Set([
  "not-a-git-repository",
  "no-upstream",
  "detached-head",
  "git-not-installed",
  "dirty-tree",
  "non-fast-forward",
  "network-error",
  "timeout",
]);

export class GitOperationConflictError extends Error {
  constructor() {
    super("Another git operation is already running for this application.");
    this.name = "GitOperationConflictError";
  }
}

export class HttpDashboardDataSource implements DashboardDataSource {
  async listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]> {
    const response = await fetch("/api/applications", { signal: signal ?? null });
    if (!response.ok) {
      throw new Error(`Application listing request failed with status ${response.status}.`);
    }
    const payload: unknown = await response.json();
    return parseApplicationListing(payload);
  }

  async getGitStatus(applicationId: string, signal?: AbortSignal): Promise<GitStatus> {
    const response = await fetch(`/api/homebase/applications/${encodeURIComponent(applicationId)}/git-status`, {
      signal: signal ?? null,
    });
    if (!response.ok) {
      throw new Error(`Git status request failed with status ${response.status}.`);
    }
    return parseGitStatus(await response.json());
  }

  async fetchGit(applicationId: string, signal?: AbortSignal): Promise<GitStatus> {
    const response = await fetch(
      `/api/homebase/applications/${encodeURIComponent(applicationId)}/git-status/fetch`,
      { method: "POST", signal: signal ?? null },
    );
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null);
      if (isConflictBody(body)) throw new GitOperationConflictError();
    }
    if (!response.ok) {
      throw new Error(`Git fetch request failed with status ${response.status}.`);
    }
    return parseGitStatus(await response.json());
  }

  async pullGit(applicationId: string, signal?: AbortSignal): Promise<GitMutationResult> {
    const response = await fetch(
      `/api/homebase/applications/${encodeURIComponent(applicationId)}/git-status/pull`,
      { method: "POST", signal: signal ?? null },
    );
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null);
      if (isConflictBody(body)) throw new GitOperationConflictError();
      return parseGitMutationResult(body);
    }
    if (!response.ok) {
      throw new Error(`Git pull request failed with status ${response.status}.`);
    }
    return parseGitMutationResult(await response.json());
  }
}

function isConflictBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).error === "operation-in-progress"
  );
}

function parseGitStatus(payload: unknown): GitStatus {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Git status response was not an object.");
  }
  const { branch, commit, workingTree, upstream, ahead, behind, checkedAt, error } = payload as Record<
    string,
    unknown
  >;
  if (branch !== null && typeof branch !== "string") {
    throw new Error("Git status response had a malformed branch.");
  }
  if (commit !== null && typeof commit !== "string") {
    throw new Error("Git status response had a malformed commit.");
  }
  if (typeof workingTree !== "string" || !knownWorkingTreeStates.has(workingTree as WorkingTreeState)) {
    throw new Error("Git status response had an unknown workingTree.");
  }
  if (upstream !== null && typeof upstream !== "string") {
    throw new Error("Git status response had a malformed upstream.");
  }
  if (ahead !== null && typeof ahead !== "number") {
    throw new Error("Git status response had a malformed ahead count.");
  }
  if (behind !== null && typeof behind !== "number") {
    throw new Error("Git status response had a malformed behind count.");
  }
  if (typeof checkedAt !== "string") {
    throw new Error("Git status response had a malformed checkedAt.");
  }
  if (error !== undefined && (typeof error !== "string" || !knownGitErrors.has(error))) {
    throw new Error("Git status response had an unknown error code.");
  }

  return {
    branch: branch as string | null,
    commit: commit as string | null,
    workingTree: workingTree as WorkingTreeState,
    upstream: upstream as string | null,
    ahead: ahead as number | null,
    behind: behind as number | null,
    checkedAt,
    ...(error !== undefined ? { error: error as GitStatusError | GitMutationError } : {}),
  };
}

function parseGitMutationResult(payload: unknown): GitMutationResult {
  const status = parseGitStatus(payload);
  const pulled = (payload as Record<string, unknown>).pulled;
  if (typeof pulled !== "boolean") {
    throw new Error("Git mutation response had a malformed pulled flag.");
  }
  return { ...status, pulled };
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
