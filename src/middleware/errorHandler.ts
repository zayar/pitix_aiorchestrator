import type { NextFunction, Request, Response } from "express";
import { AppError, isAppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Route not found: ${req.method} ${req.path}`, { statusCode: 404, code: "not_found" }));
};

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = String((req as Request & { requestId?: string }).requestId ?? "").trim();
  const appError = isAppError(error)
    ? error
    : new AppError(error instanceof Error ? error.message : "Internal error");

  logger.error("Request failed", {
    requestId,
    code: appError.code,
    statusCode: appError.statusCode,
    details: appError.details,
    error: appError.message,
  });

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId,
    },
  });
};

