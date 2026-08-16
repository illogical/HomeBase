import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];
export const state = { activeUntil: 0 };

export function scheduleActiveWork(durationMs: number): void {
  state.activeUntil = Date.now() + durationMs;
}

const createActiveWorkFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  async getStatus() {
    return { state: "ready", summary: "Active work fixture ready.", since: new Date().toISOString() };
  },
  async getActiveWork() {
    const hasActiveWork = Date.now() < state.activeUntil;
    effects.push(`getActiveWork:${hasActiveWork}`);
    return hasActiveWork
      ? { hasActiveWork, description: "scripted background work" }
      : { hasActiveWork };
  },
  async dispose() {
    effects.push("dispose");
  },
});

export default createActiveWorkFixture;
