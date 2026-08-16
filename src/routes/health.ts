import { Router } from "express";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  router.get("/ready", (_request, response) => {
    response.status(200).json({ status: "ready" });
  });

  return router;
}
