import type { DashboardApplication, DashboardDataSource, GitMutationResult, GitStatus } from "./models";

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

export class FixtureDashboardDataSource implements DashboardDataSource {
  constructor(private readonly scenario: FixtureScenario) {}

  listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]> {
    if (this.scenario === "loading") {
      return waitUntilAborted(signal);
    }
    return Promise.resolve(this.scenario === "empty" ? emptyApplications : mixedApplications);
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
