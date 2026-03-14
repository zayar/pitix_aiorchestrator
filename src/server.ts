import cors from "cors";
import express from "express";
import { config } from "./config/index.js";
import { requestContextMiddleware } from "./middleware/requestContext.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { pitixVoiceSaleRouter } from "./routes/pitixVoiceSale.js";

export const createServer = () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(requestContextMiddleware);

  app.use("/health", healthRouter);
  app.use("/api/pitix", pitixVoiceSaleRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

