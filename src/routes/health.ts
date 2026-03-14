import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "ai-orchestrator-pitix",
    buildTag: "deploy-test-20260314-1",
    time: new Date().toISOString(),
  });
});
