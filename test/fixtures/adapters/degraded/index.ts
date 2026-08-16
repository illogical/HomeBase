import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const createDegradedFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  async getStatus() {
    effects.push("getStatus");
    return {
      state: "degraded",
      summary: "An optional dependency is impaired.",
      since: new Date().toISOString(),
    };
  },
});

export default createDegradedFixture;
