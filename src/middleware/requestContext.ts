import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

export type RequestWithContext = Request & {
  requestId: string;
};

export const requestContextMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const requestId =
    String(req.headers["x-request-id"] ?? req.headers["x-correlation-id"] ?? "").trim() ||
    crypto.randomUUID();
  (req as RequestWithContext).requestId = requestId;

  logger.info("Request received", {
    requestId,
    method: req.method,
    path: req.path,
    bodyKeys: Object.keys((req.body as Record<string, unknown>) ?? {}),
    bodyPreview: config.logRequestBodies ? req.body : undefined,
  });

  next();
};

