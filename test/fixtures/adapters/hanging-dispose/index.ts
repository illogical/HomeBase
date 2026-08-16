import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const createHangingDisposeFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  async getStatus() {
    return { state: "ready", summary: "Hanging dispose fixture ready.", since: new Date().toISOString() };
  },
  async dispose() {
    effects.push("dispose-start");
    await new Promise(() => {
      // Never resolves; proves ApplicationHost's per-application dispose budget
      // does not block a sibling's disposal.
    });
  },
});

export default createHangingDisposeFixture;
