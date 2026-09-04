import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

let release: (() => void) | undefined;
let gate = new Promise<void>((resolve) => {
  release = resolve;
});

/** Lets a test control exactly when this fixture's initialize() resolves. */
export function releaseInitialize(): void {
  release?.();
}

/** Resets the gate for a fresh load in a later test. */
export function resetGate(): void {
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
}

const createSlowInitializeFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  async initialize() {
    effects.push("initialize-start");
    await gate;
    effects.push("initialize-complete");
  },
  async getStatus() {
    return { state: "ready", summary: "Slow-initialize fixture ready.", since: new Date().toISOString() };
  },
});

export default createSlowInitializeFixture;
