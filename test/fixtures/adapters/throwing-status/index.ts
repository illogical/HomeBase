import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const createThrowingStatusFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  async getStatus() {
    effects.push("getStatus");
    throw new Error("Simulated getStatus() failure.");
  },
});

export default createThrowingStatusFixture;
