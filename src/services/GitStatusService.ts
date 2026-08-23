import { execFile } from "node:child_process";

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
  | "timeout";

export interface GitStatusResult {
  readonly branch: string | null;
  readonly commit: string | null;
  readonly workingTree: WorkingTreeState;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly checkedAt: string;
  readonly error?: GitStatusError | GitMutationError;
}

export interface GitMutationResult extends GitStatusResult {
  readonly pulled: boolean;
}

const STATUS_TIMEOUT_MS = 5000;
const MUTATION_TIMEOUT_MS = 20000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

interface CommandOutcome {
  readonly stdout: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly notInstalled: boolean;
}

function runGit(args: readonly string[], cwd: string, timeoutMs: number): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: stdout.trim(), exitCode: 0, timedOut: false, notInstalled: false });
          return;
        }
        const failure = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string };
        if (failure.code !== "ENOENT") {
          console.error(`git ${args.join(" ")} failed in ${cwd}: ${stderr?.trim() || error.message}`);
        }
        resolve({
          stdout: stdout?.trim() ?? "",
          exitCode: typeof failure.code === "number" ? failure.code : 1,
          timedOut: failure.killed === true && failure.signal !== undefined,
          notInstalled: failure.code === "ENOENT",
        });
      },
    );
  });
}

export class GitStatusService {
  readonly #inFlight = new Set<string>();

  async getStatus(_applicationId: string, repositoryRoot: string): Promise<GitStatusResult> {
    return computeStatus(repositoryRoot);
  }

  async fetch(applicationId: string, repositoryRoot: string): Promise<GitStatusResult | { readonly conflict: true }> {
    if (this.#inFlight.has(applicationId)) {
      return { conflict: true };
    }
    this.#inFlight.add(applicationId);
    try {
      const outcome = await runGit(["fetch"], repositoryRoot, MUTATION_TIMEOUT_MS);
      if (outcome.exitCode !== 0) {
        return {
          ...(await computeStatus(repositoryRoot)),
          error: mutationFailureReason(outcome),
        };
      }
      return computeStatus(repositoryRoot);
    } finally {
      this.#inFlight.delete(applicationId);
    }
  }

  async pull(
    applicationId: string,
    repositoryRoot: string,
  ): Promise<GitMutationResult | { readonly conflict: true }> {
    if (this.#inFlight.has(applicationId)) {
      return { conflict: true };
    }
    this.#inFlight.add(applicationId);
    try {
      const preStatus = await computeStatus(repositoryRoot);
      if (preStatus.workingTree === "dirty") {
        return { ...preStatus, error: "dirty-tree", pulled: false };
      }
      if (preStatus.error !== undefined) {
        return { ...preStatus, pulled: false };
      }

      const outcome = await runGit(["pull", "--ff-only"], repositoryRoot, MUTATION_TIMEOUT_MS);
      const postStatus = await computeStatus(repositoryRoot);
      if (outcome.exitCode !== 0) {
        return { ...postStatus, error: mutationFailureReason(outcome), pulled: false };
      }
      return { ...postStatus, pulled: true };
    } finally {
      this.#inFlight.delete(applicationId);
    }
  }
}

function mutationFailureReason(outcome: CommandOutcome): GitMutationError {
  if (outcome.notInstalled) return "git-not-installed";
  if (outcome.timedOut) return "timeout";
  return "network-error";
}

async function computeStatus(repositoryRoot: string): Promise<GitStatusResult> {
  const checkedAt = new Date().toISOString();

  const toplevel = await runGit(["rev-parse", "--is-inside-work-tree"], repositoryRoot, STATUS_TIMEOUT_MS);
  if (toplevel.notInstalled) {
    return emptyResult(checkedAt, "git-not-installed");
  }
  if (toplevel.exitCode !== 0 || toplevel.stdout !== "true") {
    return emptyResult(checkedAt, "not-a-git-repository");
  }

  const [branchResult, commitResult, statusResult] = await Promise.all([
    runGit(["branch", "--show-current"], repositoryRoot, STATUS_TIMEOUT_MS),
    runGit(["rev-parse", "HEAD"], repositoryRoot, STATUS_TIMEOUT_MS),
    runGit(["status", "--porcelain"], repositoryRoot, STATUS_TIMEOUT_MS),
  ]);

  const branch = branchResult.exitCode === 0 && branchResult.stdout !== "" ? branchResult.stdout : null;
  const commit = commitResult.exitCode === 0 && commitResult.stdout !== "" ? commitResult.stdout : null;
  const workingTree: WorkingTreeState =
    statusResult.exitCode === 0 ? (statusResult.stdout === "" ? "clean" : "dirty") : "unknown";

  if (branch === null) {
    return {
      branch: null,
      commit,
      workingTree,
      upstream: null,
      ahead: null,
      behind: null,
      checkedAt,
      error: "detached-head",
    };
  }

  const upstreamResult = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    repositoryRoot,
    STATUS_TIMEOUT_MS,
  );
  if (upstreamResult.exitCode !== 0 || upstreamResult.stdout === "") {
    return {
      branch,
      commit,
      workingTree,
      upstream: null,
      ahead: null,
      behind: null,
      checkedAt,
      error: "no-upstream",
    };
  }
  const upstream = upstreamResult.stdout;

  const aheadBehindResult = await runGit(
    ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
    repositoryRoot,
    STATUS_TIMEOUT_MS,
  );
  let ahead: number | null = null;
  let behind: number | null = null;
  if (aheadBehindResult.exitCode === 0) {
    const parts = aheadBehindResult.stdout.split(/\s+/u);
    if (parts.length === 2) {
      const parsedAhead = Number.parseInt(parts[0]!, 10);
      const parsedBehind = Number.parseInt(parts[1]!, 10);
      if (Number.isFinite(parsedAhead) && Number.isFinite(parsedBehind)) {
        ahead = parsedAhead;
        behind = parsedBehind;
      }
    }
  }

  return { branch, commit, workingTree, upstream, ahead, behind, checkedAt };
}

function emptyResult(checkedAt: string, error: GitStatusError): GitStatusResult {
  return {
    branch: null,
    commit: null,
    workingTree: "unknown",
    upstream: null,
    ahead: null,
    behind: null,
    checkedAt,
    error,
  };
}
