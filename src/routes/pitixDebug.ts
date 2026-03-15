import { Router } from "express";
import { PitiXBackendAdapter } from "../adapters/PitiXBackendAdapter.js";
import { config } from "../config/index.js";
import type {
  PitiXSession,
  TestAccountRequestBody,
  TestPosReadRequestBody,
} from "../types/contracts.js";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { AppError, isAppError } from "../utils/errors.js";

export const pitixDebugRouter = Router();

const pitixBackendAdapter = new PitiXBackendAdapter();

const readToken = (value: unknown): string =>
  String(value ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const buildSession = (req: RequestWithContext): PitiXSession => {
  const body = (req.body ?? {}) as Partial<TestPosReadRequestBody> & Record<string, unknown>;
  const token = readToken(body.token ?? req.headers.authorization);
  const refreshToken = String(body.refreshToken ?? "").trim() || undefined;
  const businessId = String(body.businessId ?? "").trim();
  const userId = String(body.userId ?? "").trim();
  const storeId = String(body.storeId ?? "").trim() || undefined;
  const storeName = String(body.storeName ?? "").trim() || undefined;
  const userName = String(body.userName ?? "").trim() || undefined;
  const saleChannelName = String(body.saleChannelName ?? "").trim() || undefined;

  if (!token) {
    throw new AppError("token is required in the request body or Authorization header.", {
      statusCode: 400,
      code: "missing_access_token",
    });
  }
  if (!businessId || !userId) {
    throw new AppError("businessId and userId are required.", {
      statusCode: 400,
      code: "missing_context",
    });
  }

  return {
    token,
    refreshToken,
    businessId,
    userId,
    storeId,
    storeName,
    userName,
    saleChannel: saleChannelName ? { name: saleChannelName } : undefined,
  };
};

pitixDebugRouter.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "ai-orchestrator-pitix",
    pitix: {
      accountGraphqlUrl: config.pitixAccountGraphqlUrl,
      posGraphqlUrl: config.pitixPosGraphqlUrl,
      requestTimeoutMs: config.pitixRequestTimeoutMs,
      debugLogs: config.pitixDebugLogs,
    },
    time: new Date().toISOString(),
  });
});

pitixDebugRouter.post("/test-account", (req, res, next) => {
  const execute = async () => {
    const body = (req.body ?? {}) as TestAccountRequestBody;
    const requestId = String(body.requestId ?? "").trim();
    const refreshToken = String(body.refreshToken ?? "").trim();

    if (requestId && refreshToken) {
      throw new AppError("Provide either requestId or refreshToken, not both.", {
        statusCode: 400,
        code: "invalid_debug_input",
      });
    }
    if (!requestId && !refreshToken) {
      throw new AppError("requestId or refreshToken is required.", {
        statusCode: 400,
        code: "missing_debug_input",
      });
    }

    if (requestId) {
      const verified = await pitixBackendAdapter.verifyOTA(requestId, (req as RequestWithContext).requestId);
      res.json({
        ok: true,
        operation: "verifyOTA",
        auth: verified,
      });
      return;
    }

    const refreshed = await pitixBackendAdapter.refreshToken(refreshToken, (req as RequestWithContext).requestId);
    res.json({
      ok: true,
      operation: "refreshToken",
      auth: refreshed,
    });
  };

  void execute().catch(next);
});

pitixDebugRouter.post("/test-pos-read", (req, res, next) => {
  const execute = async () => {
    const request = req as RequestWithContext;
    const session = buildSession(request);
    const startedAtMs = Date.now();
    const endpoint = config.pitixPosGraphqlUrl;
    const operationName = "BusinessPing";

    try {
      const business = await pitixBackendAdapter.pingBusiness(session, request.requestId);

      res.json({
        ok: true,
        endpoint,
        operationName,
        elapsedMs: Date.now() - startedAtMs,
        requestId: request.requestId,
        businessId: session.businessId,
        userId: session.userId,
        storeId: session.storeId ?? null,
        hasRefreshToken: Boolean(session.refreshToken),
        result: business
          ? {
              found: true,
              business,
            }
          : {
              found: false,
              business: null,
            },
      });
      return;
    } catch (error) {
      if (isAppError(error)) {
        res.status(error.statusCode).json({
          ok: false,
          endpoint,
          operationName,
          elapsedMs: Date.now() - startedAtMs,
          requestId: request.requestId,
          businessId: session.businessId,
          userId: session.userId,
          storeId: session.storeId ?? null,
          hasRefreshToken: Boolean(session.refreshToken),
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
        return;
      }

      next(error);
    }
  };

  void execute().catch(next);
});
