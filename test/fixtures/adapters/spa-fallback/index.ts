import { fileURLToPath } from "node:url";
import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));

const createSpaFallbackFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  staticAssets: { directory: publicDirectory, spaFallback: true },
  async getStatus() {
    effects.push("getStatus");
    return {
      state: "ready",
      summary: "SPA fallback fixture ready.",
      since: new Date().toISOString(),
    };
  },
});

export default createSpaFallbackFixture;
