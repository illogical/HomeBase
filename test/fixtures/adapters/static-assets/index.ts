import { fileURLToPath } from "node:url";
import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));

const createStaticAssetsFixture: CreateHostedApplication = () => ({
  contractVersion: HOSTED_CONTRACT_VERSION,
  staticAssets: { directory: publicDirectory, spaFallback: false },
  async getStatus() {
    effects.push("getStatus");
    return {
      state: "ready",
      summary: "Static assets fixture ready.",
      since: new Date().toISOString(),
    };
  },
});

export default createStaticAssetsFixture;
