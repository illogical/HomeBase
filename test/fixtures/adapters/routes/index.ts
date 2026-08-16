import { Router } from "express";
import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

const createRoutesFixture: CreateHostedApplication = (options) => {
  const router = Router();
  router.get("/ping", (_request, response) => {
    effects.push("ping");
    response.json({ ok: true, applicationId: options.applicationId });
  });
  router.get("/echo/:value", (request, response) => {
    effects.push(`echo:${request.params.value}`);
    response.json({ value: request.params.value });
  });

  return {
    contractVersion: HOSTED_CONTRACT_VERSION,
    router,
    async getStatus() {
      effects.push("getStatus");
      return { state: "ready", summary: "Routes fixture ready.", since: new Date().toISOString() };
    },
  };
};

export default createRoutesFixture;
