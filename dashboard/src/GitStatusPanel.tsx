import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardDataSource, GitMutationResult, GitStatus } from "./models";
import { GitOperationConflictError } from "./httpDataSource";

export interface GitStatusPanelProps {
  readonly applicationId: string;
  readonly dataSource: DashboardDataSource;
}

type Busy = "refresh" | "fetch" | "pull" | null;

interface PanelState {
  readonly status: GitStatus | null;
  readonly loadFailed: boolean;
  readonly busy: Busy;
  readonly actionError: string | null;
}

const errorMessages: Readonly<Record<string, string>> = {
  "not-a-git-repository": "Not a git repository.",
  "no-upstream": "No upstream branch configured.",
  "detached-head": "Detached HEAD.",
  "git-not-installed": "git is not available on the host.",
  "dirty-tree": "Working tree has uncommitted changes.",
  "non-fast-forward": "Cannot fast-forward.",
  "network-error": "Network error contacting the remote.",
  timeout: "Git command timed out.",
};

function describeError(code: string | undefined): string | null {
  if (code === undefined) return null;
  return errorMessages[code] ?? code;
}

function RefreshIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

function FetchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="12" y1="3" x2="12" y2="15" />
      <polyline points="6 11 12 17 18 11" />
    </svg>
  );
}

function PullIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="12" y1="3" x2="12" y2="13" />
      <polyline points="7 9 12 14 17 9" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export function GitStatusPanel({ applicationId, dataSource }: GitStatusPanelProps) {
  const [state, setState] = useState<PanelState>({
    status: null,
    loadFailed: false,
    busy: null,
    actionError: null,
  });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    (signal?: AbortSignal) => {
      dataSource.getGitStatus(applicationId, signal).then(
        (status) => {
          if (mountedRef.current) {
            setState({ status, loadFailed: false, busy: null, actionError: null });
          }
        },
        (error: unknown) => {
          if (mountedRef.current && !isAbortError(error)) {
            setState((current) => ({ ...current, loadFailed: true, busy: null }));
          }
        },
      );
    },
    [applicationId, dataSource],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const runAction = useCallback(
    (busy: Exclude<Busy, null>, run: () => Promise<GitStatus | GitMutationResult>) => {
      setState((current) => ({ ...current, busy, actionError: null }));
      run().then(
        (result) => {
          if (mountedRef.current) {
            setState({ status: result, loadFailed: false, busy: null, actionError: null });
          }
        },
        (error: unknown) => {
          if (!mountedRef.current) return;
          const message =
            error instanceof GitOperationConflictError
              ? "Already running for this application."
              : "Request failed. Try again.";
          setState((current) => ({ ...current, busy: null, actionError: message }));
        },
      );
    },
    [],
  );

  const refresh = useCallback(() => {
    runAction("refresh", () => dataSource.getGitStatus(applicationId));
  }, [applicationId, dataSource, runAction]);

  const runFetch = useCallback(() => {
    runAction("fetch", () => dataSource.fetchGit(applicationId));
  }, [applicationId, dataSource, runAction]);

  const runPull = useCallback(() => {
    runAction("pull", () => dataSource.pullGit(applicationId));
  }, [applicationId, dataSource, runAction]);

  if (state.loadFailed) {
    return (
      <div className="git-panel git-panel-error">
        <span>Git status unavailable.</span>
        <button type="button" onClick={refresh} disabled={state.busy !== null}>
          Retry
        </button>
      </div>
    );
  }

  if (state.status === null) {
    return (
      <div className="git-panel git-panel-loading" aria-live="polite">
        <span className="git-skeleton" aria-hidden="true" />
      </div>
    );
  }

  const { status } = state;
  const clean = status.workingTree === "clean";
  const hasUpstream = status.error !== "no-upstream" && status.error !== "detached-head";
  const behind = status.behind ?? 0;
  const ahead = status.ahead ?? 0;
  const canPull = hasUpstream && clean && behind > 0 && state.busy === null;
  const displayMessage = state.actionError ?? describeError(status.error);

  return (
    <div className="git-panel">
      <div className="git-summary">
        <span className={`git-tree-dot git-tree-${status.workingTree}`} aria-hidden="true" />
        <span className="git-branch" title={status.branch ?? undefined}>
          {status.branch ?? "detached"}
        </span>
        {hasUpstream && status.upstream !== null ? (
          <span className="git-ahead-behind" title={`Ahead ${ahead}, behind ${behind} of ${status.upstream}`}>
            {ahead > 0 ? <span className="git-ahead">↑{ahead}</span> : null}
            {behind > 0 ? <span className="git-behind">↓{behind}</span> : null}
            {ahead === 0 && behind === 0 ? <span className="git-up-to-date">up to date</span> : null}
          </span>
        ) : (
          <span className="git-no-upstream">{status.error === "detached-head" ? "detached" : "no upstream"}</span>
        )}
      </div>

      {displayMessage !== null ? (
        <p className="git-message" role="status">
          {displayMessage}
        </p>
      ) : null}

      <div className="git-actions">
        <button
          type="button"
          onClick={refresh}
          disabled={state.busy !== null}
          aria-busy={state.busy === "refresh"}
          aria-label={state.busy === "refresh" ? "Refreshing…" : "Refresh"}
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          onClick={runFetch}
          disabled={state.busy !== null || !hasUpstream}
          aria-busy={state.busy === "fetch"}
          aria-label={state.busy === "fetch" ? "Fetching…" : "Fetch"}
          title="Fetch"
        >
          <FetchIcon />
        </button>
        <button
          type="button"
          className="git-pull-button"
          onClick={runPull}
          disabled={!canPull}
          aria-busy={state.busy === "pull"}
          aria-label={state.busy === "pull" ? "Pulling…" : "Pull"}
          title={!clean ? "Working tree is dirty" : behind === 0 ? "Already up to date" : "Pull latest"}
        >
          <PullIcon />
        </button>
      </div>
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
