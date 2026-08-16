import type { DashboardApplication, DashboardDataSource } from "./models";

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

export class FixtureDashboardDataSource implements DashboardDataSource {
  constructor(private readonly scenario: FixtureScenario) {}

  listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]> {
    if (this.scenario === "loading") {
      return waitUntilAborted(signal);
    }
    return Promise.resolve(this.scenario === "empty" ? emptyApplications : mixedApplications);
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
