import type {
  ApplicationViewState,
  DashboardApplication,
  DashboardDataSource,
  GitMutationError,
  GitMutationResult,
  GitStatus,
  GitStatusError,
  OutputChunk,
  PackageScriptsError,
  RunState,
  RunStarted,
  RunStatus,
  ScriptsResult,
  WorkingTreeState,
} from "./models";
import { RunOperationConflictError } from "./models";
import { subscribeToRunOutput } from "./socketClient";

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

  async retryApplication(applicationId: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/retry`, {
      method: "POST",
      signal: signal ?? null,
    });
    if (!response.ok) {
      throw new Error(`Retry request failed with status ${response.status}.`);
    }
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

  async listScripts(applicationId: string, signal?: AbortSignal): Promise<ScriptsResult> {
    const response = await fetch(`/api/homebase/applications/${encodeURIComponent(applicationId)}/scripts`, {
      signal: signal ?? null,
    });
    if (!response.ok) {
      throw new Error(`Scripts listing request failed with status ${response.status}.`);
    }
    return parseScriptsResult(await response.json());
  }

  async runScript(applicationId: string, scriptName: string, signal?: AbortSignal): Promise<RunStarted> {
    const response = await fetch(
      `/api/homebase/applications/${encodeURIComponent(applicationId)}/scripts/${encodeURIComponent(scriptName)}/run`,
      { method: "POST", signal: signal ?? null },
    );
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null);
      const runId = conflictRunId(body);
      if (runId !== null) throw new RunOperationConflictError(runId);
    }
    if (!response.ok) {
      throw new Error(`Run request failed with status ${response.status}.`);
    }
    return parseRunStarted(await response.json());
  }

  async stopScript(applicationId: string, runId: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(
      `/api/homebase/applications/${encodeURIComponent(applicationId)}/scripts/run/${encodeURIComponent(runId)}/stop`,
      { method: "POST", signal: signal ?? null },
    );
    if (!response.ok) {
      throw new Error(`Stop request failed with status ${response.status}.`);
    }
  }

  async getCurrentRun(applicationId: string, signal?: AbortSignal): Promise<RunState | null> {
    const response = await fetch(
      `/api/homebase/applications/${encodeURIComponent(applicationId)}/scripts/run/current`,
      { signal: signal ?? null },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Current run request failed with status ${response.status}.`);
    }
    return parseRunState(await response.json());
  }

  async getRunReplay(applicationId: string, runId: string, signal?: AbortSignal): Promise<RunState> {
    const response = await fetch(
      `/api/homebase/applications/${encodeURIComponent(applicationId)}/scripts/run/${encodeURIComponent(runId)}`,
      { signal: signal ?? null },
    );
    if (!response.ok) {
      throw new Error(`Run replay request failed with status ${response.status}.`);
    }
    return parseRunState(await response.json());
  }

  subscribeToRunOutput(
    runId: string,
    onOutput: (chunk: OutputChunk) => void,
    onStatus: (run: RunState) => void,
  ): () => void {
    return subscribeToRunOutput(runId, onOutput, onStatus);
  }
}

function conflictRunId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.error !== "operation-in-progress") return null;
  return typeof record.runId === "string" ? record.runId : null;
}

const knownScriptErrors: ReadonlySet<string> = new Set(["no-package-json", "invalid-package-json", "read-error"]);
const knownRunStatuses: ReadonlySet<string> = new Set(["running", "exited", "killed", "error"]);

function parseScriptsResult(payload: unknown): ScriptsResult {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Scripts response was not an object.");
  }
  const { scripts, checkedAt, error } = payload as Record<string, unknown>;
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    throw new Error("Scripts response had a malformed scripts map.");
  }
  for (const value of Object.values(scripts as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new Error("Scripts response had a malformed script command.");
    }
  }
  if (typeof checkedAt !== "string") {
    throw new Error("Scripts response had a malformed checkedAt.");
  }
  if (error !== undefined && (typeof error !== "string" || !knownScriptErrors.has(error))) {
    throw new Error("Scripts response had an unknown error code.");
  }
  return {
    scripts: scripts as Record<string, string>,
    checkedAt,
    ...(error !== undefined ? { error: error as PackageScriptsError } : {}),
  };
}

function parseRunStarted(payload: unknown): RunStarted {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Run start response was not an object.");
  }
  const { runId, startedAt } = payload as Record<string, unknown>;
  if (typeof runId !== "string" || typeof startedAt !== "string") {
    throw new Error("Run start response had malformed fields.");
  }
  return { runId, startedAt };
}

function parseRunState(payload: unknown): RunState {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Run state response was not an object.");
  }
  const { runId, applicationId, scriptName, status, exitCode, startedAt, finishedAt, output } =
    payload as Record<string, unknown>;
  if (
    typeof runId !== "string" ||
    typeof applicationId !== "string" ||
    typeof scriptName !== "string" ||
    typeof startedAt !== "string"
  ) {
    throw new Error("Run state response had missing or malformed string fields.");
  }
  if (typeof status !== "string" || !knownRunStatuses.has(status)) {
    throw new Error("Run state response had an unknown status.");
  }
  if (exitCode !== null && typeof exitCode !== "number") {
    throw new Error("Run state response had a malformed exitCode.");
  }
  if (finishedAt !== null && typeof finishedAt !== "string") {
    throw new Error("Run state response had a malformed finishedAt.");
  }
  if (!Array.isArray(output)) {
    throw new Error("Run state response had a malformed output array.");
  }
  return {
    runId,
    applicationId,
    scriptName,
    status: status as RunStatus,
    exitCode: exitCode as number | null,
    startedAt,
    finishedAt: finishedAt as string | null,
    output: output.map(parseOutputChunk),
  };
}

function parseOutputChunk(entry: unknown): OutputChunk {
  if (typeof entry !== "object" || entry === null) {
    throw new Error("Output chunk was not an object.");
  }
  const { seq, stream, data, timestamp } = entry as Record<string, unknown>;
  if (typeof seq !== "number" || (stream !== "stdout" && stream !== "stderr") || typeof data !== "string" ||
    typeof timestamp !== "string") {
    throw new Error("Output chunk had malformed fields.");
  }
  return { seq, stream, data, timestamp };
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
