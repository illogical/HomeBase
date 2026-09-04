import type {
  DashboardApplication,
  DashboardDataSource,
  GitMutationResult,
  GitStatus,
  OutputChunk,
  RunStarted,
  RunState,
  ScriptsResult,
} from "./models";
import { RunOperationConflictError } from "./models";

export type FixtureScenario = "mixed" | "loading" | "empty";

const mixedApplications = Object.freeze([
  freezeApplication({
    id: "devplanner",
    displayName: "DevPlanner",
    description: "Plan development work and keep implementation steps organized.",
    basePath: "/devplanner/",
    state: "ready",
    statusSummary: "Sample status: ready for a future hosted launch.",
  }),
  freezeApplication({
    id: "lmapi",
    displayName: "LMApi",
    description: "Explore and exercise language-model API workflows.",
    basePath: "/lmapi/",
    state: "degraded",
    statusSummary: "Sample status: available with an illustrative limitation.",
  }),
  freezeApplication({
    id: "memoryapi",
    displayName: "MemoryApi",
    description: "Inspect and manage application memory services.",
    basePath: "/memoryapi/",
    state: "disabled",
    statusSummary: "Sample status: disabled in this prototype scenario.",
  }),
  freezeApplication({
    id: "lmeval",
    displayName: "LMEval",
    description: "Review language-model evaluation runs and results.",
    basePath: "/lmeval/",
    state: "unavailable",
    statusSummary: "Sample status: unavailable for this prototype scenario.",
  }),
] satisfies DashboardApplication[]);

const emptyApplications = Object.freeze([]) as readonly DashboardApplication[];

const fixtureGitStatus: GitStatus = Object.freeze({
  branch: "main",
  commit: "a1b2c3d",
  workingTree: "clean",
  upstream: "origin/main",
  ahead: 0,
  behind: 2,
  checkedAt: new Date().toISOString(),
});

const fixtureScripts: Readonly<Record<string, string>> = {
  build: "vite build",
  lint: "eslint .",
  dev: "vite dev",
};

const longRunningScripts = new Set(["dev", "start", "watch"]);

type RunListener = { onOutput: (chunk: OutputChunk) => void; onStatus: (run: RunState) => void };

export class FixtureDashboardDataSource implements DashboardDataSource {
  private readonly runsByApplication = new Map<string, RunState>();
  private readonly runsById = new Map<string, RunState>();
  private readonly listenersByRun = new Map<string, Set<RunListener>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly applicationOverrides = new Map<string, DashboardApplication>();

  constructor(private readonly scenario: FixtureScenario) {}

  listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]> {
    if (this.scenario === "loading") {
      return waitUntilAborted(signal);
    }
    if (this.scenario === "empty") {
      return Promise.resolve(emptyApplications);
    }
    return Promise.resolve(
      Object.freeze(
        mixedApplications.map((application) => this.applicationOverrides.get(application.id) ?? application),
      ),
    );
  }

  retryApplication(applicationId: string): Promise<void> {
    const base = mixedApplications.find((application) => application.id === applicationId);
    if (!base) return Promise.resolve();

    this.applicationOverrides.set(
      applicationId,
      freezeApplication({ ...base, state: "loading", statusSummary: "Waiting to retry." }),
    );

    const timerKey = `retry:${applicationId}`;
    const existing = this.timers.get(timerKey);
    if (existing !== undefined) clearTimeout(existing);
    this.timers.set(
      timerKey,
      setTimeout(() => {
        this.applicationOverrides.set(
          applicationId,
          freezeApplication({ ...base, state: "ready", statusSummary: "Ready." }),
        );
        this.timers.delete(timerKey);
      }, 800),
    );

    return Promise.resolve();
  }

  getGitStatus(): Promise<GitStatus> {
    return Promise.resolve(fixtureGitStatus);
  }

  fetchGit(): Promise<GitStatus> {
    return Promise.resolve({ ...fixtureGitStatus, checkedAt: new Date().toISOString() });
  }

  pullGit(): Promise<GitMutationResult> {
    return Promise.resolve({ ...fixtureGitStatus, behind: 0, checkedAt: new Date().toISOString(), pulled: true });
  }

  listScripts(): Promise<ScriptsResult> {
    return Promise.resolve({ scripts: fixtureScripts, checkedAt: new Date().toISOString() });
  }

  runScript(applicationId: string, scriptName: string): Promise<RunStarted> {
    const existing = this.runsByApplication.get(applicationId);
    if (existing !== undefined && existing.status === "running") {
      return Promise.reject(new RunOperationConflictError(existing.runId));
    }

    const runId = `fixture-${applicationId}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const run: RunState = {
      runId,
      applicationId,
      scriptName,
      status: "running",
      exitCode: null,
      startedAt,
      finishedAt: null,
      output: [],
    };
    this.runsByApplication.set(applicationId, run);
    this.runsById.set(runId, run);
    this.simulate(run, longRunningScripts.has(scriptName));
    return Promise.resolve({ runId, startedAt });
  }

  stopScript(_applicationId: string, runId: string): Promise<void> {
    const timer = this.timers.get(runId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(runId);
    }
    const run = this.runsById.get(runId);
    if (run !== undefined && run.status === "running") {
      this.updateRun(runId, { status: "killed", finishedAt: new Date().toISOString() });
    }
    return Promise.resolve();
  }

  getCurrentRun(applicationId: string): Promise<RunState | null> {
    return Promise.resolve(this.runsByApplication.get(applicationId) ?? null);
  }

  getRunReplay(_applicationId: string, runId: string): Promise<RunState> {
    const run = this.runsById.get(runId);
    return run !== undefined ? Promise.resolve(run) : Promise.reject(new Error("Fixture run not found."));
  }

  subscribeToRunOutput(
    runId: string,
    onOutput: (chunk: OutputChunk) => void,
    onStatus: (run: RunState) => void,
  ): () => void {
    const listener: RunListener = { onOutput, onStatus };
    const listeners = this.listenersByRun.get(runId) ?? new Set();
    listeners.add(listener);
    this.listenersByRun.set(runId, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  private simulate(run: RunState, longRunning: boolean): void {
    const lines = [
      `> ${run.scriptName}`,
      `Running ${run.scriptName} for ${run.applicationId}…`,
      longRunning ? "Watching for changes." : "Done.",
    ];
    let index = 0;
    const emitNext = (): void => {
      if (index < lines.length) {
        this.emitOutput(run.runId, `${lines[index]}\n`);
        index += 1;
        this.timers.set(run.runId, setTimeout(emitNext, 500));
        return;
      }
      this.timers.delete(run.runId);
      if (!longRunning) {
        this.updateRun(run.runId, { status: "exited", exitCode: 0, finishedAt: new Date().toISOString() });
      }
    };
    this.timers.set(run.runId, setTimeout(emitNext, 300));
  }

  private emitOutput(runId: string, data: string): void {
    const run = this.runsById.get(runId);
    if (run === undefined) return;
    const chunk: OutputChunk = { seq: run.output.length, stream: "stdout", data, timestamp: new Date().toISOString() };
    const updated: RunState = { ...run, output: [...run.output, chunk] };
    this.runsById.set(runId, updated);
    this.runsByApplication.set(updated.applicationId, updated);
    for (const listener of this.listenersByRun.get(runId) ?? []) {
      listener.onOutput(chunk);
    }
  }

  private updateRun(runId: string, patch: Partial<RunState>): void {
    const run = this.runsById.get(runId);
    if (run === undefined) return;
    const updated: RunState = { ...run, ...patch };
    this.runsById.set(runId, updated);
    this.runsByApplication.set(updated.applicationId, updated);
    for (const listener of this.listenersByRun.get(runId) ?? []) {
      listener.onStatus(updated);
    }
  }
}

export function selectFixtureScenario(search: string): FixtureScenario {
  const requested = new URLSearchParams(search).get("fixture");
  return requested === "loading" || requested === "empty" ? requested : "mixed";
}

export function createFixtureDataSource(search: string): DashboardDataSource {
  return new FixtureDashboardDataSource(selectFixtureScenario(search));
}

function freezeApplication(application: DashboardApplication): DashboardApplication {
  return Object.freeze(application);
}

function waitUntilAborted(
  signal?: AbortSignal,
): Promise<readonly DashboardApplication[]> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    signal?.addEventListener("abort", () => reject(createAbortError()), { once: true });
  });
}

function createAbortError(): DOMException {
  return new DOMException("The fixture request was aborted.", "AbortError");
}
