import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardDataSource, OutputChunk, RunState } from "./models";
import { RunOperationConflictError } from "./models";

export interface ScriptRunnerCardBackProps {
  readonly applicationId: string;
  readonly dataSource: DashboardDataSource;
}

type Phase = "loading" | "list" | "running" | "exited";

interface PanelState {
  readonly phase: Phase;
  readonly scripts: Readonly<Record<string, string>>;
  readonly scriptsMessage: string | null;
  readonly loadFailed: boolean;
  readonly run: RunState | null;
  readonly actionError: string | null;
  readonly starting: string | null;
  readonly stopping: boolean;
}

const scriptsErrorMessages: Readonly<Record<string, string>> = {
  "no-package-json": "No package.json found for this application.",
  "invalid-package-json": "package.json could not be parsed.",
  "read-error": "package.json could not be read.",
};

const initialState: PanelState = {
  phase: "loading",
  scripts: {},
  scriptsMessage: null,
  loadFailed: false,
  run: null,
  actionError: null,
  starting: null,
  stopping: false,
};

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function ScriptRunnerCardBack({ applicationId, dataSource }: ScriptRunnerCardBackProps) {
  const [state, setState] = useState<PanelState>(initialState);
  const mountedRef = useRef(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  const attachRun = useCallback(
    (run: RunState) => {
      unsubscribeRef.current?.();
      stickToBottomRef.current = true;
      setState((current) => ({
        ...current,
        phase: run.status === "running" ? "running" : "exited",
        run,
        actionError: null,
        starting: null,
        stopping: false,
      }));
      unsubscribeRef.current = dataSource.subscribeToRunOutput(
        run.runId,
        (chunk: OutputChunk) => {
          if (!mountedRef.current) return;
          setState((current) => {
            if (current.run === null || current.run.runId !== run.runId) return current;
            const lastSeq = current.run.output.length > 0 ? current.run.output[current.run.output.length - 1]!.seq : -1;
            if (chunk.seq <= lastSeq) return current;
            return { ...current, run: { ...current.run, output: [...current.run.output, chunk] } };
          });
        },
        (updated: RunState) => {
          if (!mountedRef.current) return;
          setState((current) => {
            if (current.run === null || current.run.runId !== updated.runId) return current;
            return {
              ...current,
              phase: current.phase === "running" ? "exited" : current.phase,
              run: updated,
              stopping: false,
            };
          });
        },
      );
    },
    [dataSource],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await dataSource.getCurrentRun(applicationId);
        if (cancelled) return;
        if (current !== null && current.status === "running") {
          attachRun(current);
          return;
        }
        const scriptsResult = await dataSource.listScripts(applicationId);
        if (cancelled) return;
        setState((state0) => ({
          ...state0,
          phase: "list",
          scripts: scriptsResult.scripts,
          scriptsMessage: scriptsResult.error !== undefined ? (scriptsErrorMessages[scriptsResult.error] ?? scriptsResult.error) : null,
        }));
      } catch {
        if (!cancelled) {
          setState((state0) => ({ ...state0, phase: "list", loadFailed: true }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per card flip — dataSource/applicationId are stable for the card's lifetime.
  }, [applicationId, attachRun, dataSource]);

  const retryLoad = useCallback(() => {
    setState((current) => ({ ...current, phase: "loading", loadFailed: false }));
    dataSource.listScripts(applicationId).then(
      (scriptsResult) => {
        if (!mountedRef.current) return;
        setState((current) => ({
          ...current,
          phase: "list",
          scripts: scriptsResult.scripts,
          scriptsMessage:
            scriptsResult.error !== undefined ? (scriptsErrorMessages[scriptsResult.error] ?? scriptsResult.error) : null,
          loadFailed: false,
        }));
      },
      () => {
        if (mountedRef.current) {
          setState((current) => ({ ...current, phase: "list", loadFailed: true }));
        }
      },
    );
  }, [applicationId, dataSource]);

  const start = useCallback(
    (scriptName: string) => {
      setState((current) => ({ ...current, starting: scriptName, actionError: null }));
      dataSource.runScript(applicationId, scriptName).then(
        (started) => {
          if (!mountedRef.current) return;
          attachRun({
            runId: started.runId,
            applicationId,
            scriptName,
            status: "running",
            exitCode: null,
            startedAt: started.startedAt,
            finishedAt: null,
            output: [],
          });
        },
        (error: unknown) => {
          if (error instanceof RunOperationConflictError) {
            dataSource.getRunReplay(applicationId, error.runId).then(
              (replay) => {
                if (mountedRef.current) attachRun(replay);
              },
              () => {
                if (mountedRef.current) {
                  setState((current) => ({
                    ...current,
                    starting: null,
                    actionError: "Another script is already running for this application.",
                  }));
                }
              },
            );
            return;
          }
          if (mountedRef.current) {
            setState((current) => ({ ...current, starting: null, actionError: "Could not start the script." }));
          }
        },
      );
    },
    [applicationId, attachRun, dataSource],
  );

  const stop = useCallback(() => {
    if (state.run === null) return;
    setState((current) => ({ ...current, stopping: true }));
    dataSource.stopScript(applicationId, state.run.runId).catch(() => {
      if (mountedRef.current) {
        setState((current) => ({ ...current, stopping: false, actionError: "Could not stop the script." }));
      }
    });
  }, [applicationId, dataSource, state.run]);

  const backToList = useCallback(() => {
    setState((current) => ({ ...current, phase: "list", actionError: null }));
  }, []);

  const viewRunning = useCallback(() => {
    setState((current) => ({ ...current, phase: "running" }));
  }, []);

  const handleScroll = useCallback(() => {
    const el = logRef.current;
    if (el === null) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el !== null && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.run?.output.length]);

  const logText = useMemo(() => state.run?.output.map((chunk) => chunk.data).join("") ?? "", [state.run]);

  if (state.phase === "loading") {
    return (
      <div className="script-panel script-panel-loading" aria-live="polite">
        <span className="git-skeleton" aria-hidden="true" />
      </div>
    );
  }

  if (state.loadFailed) {
    return (
      <div className="script-panel script-panel-error">
        <span>Scripts unavailable.</span>
        <button type="button" onClick={retryLoad}>
          Retry
        </button>
      </div>
    );
  }

  if (state.phase === "list") {
    const scriptEntries = Object.entries(state.scripts);
    return (
      <div className="script-panel">
        {state.run !== null && state.run.status === "running" ? (
          <div className="script-active-banner">
            <span>
              <span className="script-active-dot" aria-hidden="true" />
              {state.run.scriptName} is running
            </span>
            <button type="button" onClick={viewRunning}>
              View output
            </button>
          </div>
        ) : null}
        {state.actionError !== null ? (
          <p className="script-message" role="status">
            {state.actionError}
          </p>
        ) : null}
        {scriptEntries.length === 0 ? (
          <p className="script-empty">{state.scriptsMessage ?? "No scripts defined in package.json."}</p>
        ) : (
          <ul className="script-list">
            {scriptEntries.map(([name, command]) => (
              <li key={name}>
                <button
                  type="button"
                  className="script-list-item"
                  onClick={() => start(name)}
                  disabled={state.starting !== null}
                  aria-busy={state.starting === name}
                >
                  <span className="script-name">{name}</span>
                  <span className="script-command">{command}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const run = state.run;
  if (run === null) {
    return null;
  }

  return (
    <div className="script-panel script-panel-output">
      <div className="script-output-header">
        <button type="button" className="script-back-button" onClick={backToList} aria-label="Back to script list">
          <BackIcon />
        </button>
        <span className="script-run-name">{run.scriptName}</span>
        {state.phase === "running" ? (
          <span className="script-run-status script-run-status-running">
            <span className="script-active-dot" aria-hidden="true" />
            Running
          </span>
        ) : (
          <span className={`script-run-status script-run-status-${run.status}`}>
            {run.status === "exited" && run.exitCode === 0
              ? "Finished"
              : run.status === "killed"
                ? "Stopped"
                : `Exit code ${run.exitCode ?? "?"}`}
          </span>
        )}
      </div>

      <pre className="script-log" ref={logRef} onScroll={handleScroll} tabIndex={0}>
        {logText.length > 0 ? logText : "Waiting for output…"}
      </pre>

      {state.actionError !== null ? (
        <p className="script-message" role="status">
          {state.actionError}
        </p>
      ) : null}

      <div className="script-actions">
        {state.phase === "running" ? (
          <button type="button" className="script-stop-button" onClick={stop} disabled={state.stopping}>
            <StopIcon />
            {state.stopping ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <button type="button" onClick={() => start(run.scriptName)} disabled={state.starting !== null}>
            Run again
          </button>
        )}
      </div>
    </div>
  );
}
