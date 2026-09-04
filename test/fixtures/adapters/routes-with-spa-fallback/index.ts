import { fileURLToPath } from "node:url";
import { Router } from "express";
import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));

const createRoutesWithSpaFallbackFixture: CreateHostedApplication = () => {
  const router = Router();
  router.get("/ping", (_request, response) => {
    effects.push("ping");
    response.json({ ok: true });
  });

  return {
    contractVersion: HOSTED_CONTRACT_VERSION,
    router,
    staticAssets: { directory: publicDirectory, spaFallback: true },
    async getStatus() {
      effects.push("getStatus");
      return {
        state: "ready",
        summary: "Routes-with-SPA-fallback fixture ready.",
        since: new Date().toISOString(),
      };
    },
  };
};

export default createRoutesWithSpaFallbackFixture;
