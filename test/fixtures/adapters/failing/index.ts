import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const createFailingFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  async initialize() {
    effects.push("acquire-handle");
    try {
      throw new Error("Simulated initialization failure.");
    } finally {
      effects.push("release-handle");
    }
  },
  async getStatus() {
    effects.push("getStatus");
    return { state: "ready", summary: "unreachable", since: new Date().toISOString() };
  },
  async dispose() {
    effects.push("dispose");
  },
});

export default createFailingFixture;
