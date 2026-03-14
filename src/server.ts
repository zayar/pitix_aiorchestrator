import cors from "cors";
import express from "express";
import { config } from "./config/index.js";
import { requestContextMiddleware } from "./middleware/requestContext.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { pitixDebugRouter } from "./routes/pitixDebug.js";
import { pitixVoiceSaleRouter } from "./routes/pitixVoiceSale.js";

export const createServer = () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(requestContextMiddleware);

  app.get("/pitix/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "ai-orchestrator-pitix",
      scope: "pitix",
    });
  });

  app.use("/health", healthRouter);
  app.use("/pitix", pitixDebugRouter);
  app.use("/api/pitix", pitixVoiceSaleRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
