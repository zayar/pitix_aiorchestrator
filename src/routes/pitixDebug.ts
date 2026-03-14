import { Router } from "express";
import { PitiXBackendAdapter } from "../adapters/PitiXBackendAdapter.js";
import { config } from "../config/index.js";
import type {
  PitiXBusinessSummary,
  PitiXPaymentMethod,
  PitiXProduct,
  PitiXSaleChannel,
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
    businessId,
    userId,
    storeId,
    storeName,
    userName,
    saleChannel: saleChannelName ? { name: saleChannelName } : undefined,
  };
};

const withStepError = (step: string, error: unknown): never => {
  if (isAppError(error)) {
    throw new AppError(`PitiX debug step "${step}" failed: ${error.message}`, {
      statusCode: error.statusCode,
      code: error.code,
      details: {
        step,
        cause: error.details,
      },
    });
  }

  throw new AppError(`PitiX debug step "${step}" failed.`, {
    statusCode: 500,
    code: "pitix_debug_step_failed",
    details: {
      step,
      message: error instanceof Error ? error.message : String(error),
    },
  });
};

const runDebugStep = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    return withStepError(step, error);
  }
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
    const body = (request.body ?? {}) as TestPosReadRequestBody;
    const session = buildSession(request);
    const requestedProductLimit = Number(body.productLimit ?? 20);
    const productLimit = Number.isFinite(requestedProductLimit)
      ? Math.max(1, Math.min(requestedProductLimit, 50))
      : 20;

    const business = await runDebugStep<PitiXBusinessSummary | null>("business", () =>
      pitixBackendAdapter.getBusiness(session, request.requestId),
    );
    const saleChannels = await runDebugStep<PitiXSaleChannel[]>("saleChannels", () =>
      pitixBackendAdapter.getSaleChannels(session, request.requestId),
    );
    const paymentMethods = await runDebugStep<PitiXPaymentMethod[]>("paymentMethods", () =>
      pitixBackendAdapter.getPaymentMethods(session, request.requestId),
    );
    const products = await runDebugStep<PitiXProduct[]>("products", () =>
      pitixBackendAdapter.getProducts(
        session,
        {
          take: productLimit,
          activeOnly: true,
          storeId: session.storeId,
        },
        request.requestId,
      ),
    );

    res.json({
      ok: true,
      business: business
        ? {
            id: business.id,
            name: business.name,
            defaultStoreId: business.defaultStoreId ?? null,
          }
        : null,
      selectedStoreId: session.storeId ?? business?.defaultStoreId ?? null,
      saleChannelsCount: saleChannels.length,
      paymentMethodsCount: paymentMethods.length,
      productsCount: products.length,
      sampleSaleChannels: saleChannels.slice(0, 5).map((item) => ({
        id: item.id,
        name: item.name,
        code: item.code ?? null,
        storeId: item.storeId ?? null,
      })),
      samplePaymentMethods: paymentMethods.slice(0, 5).map((item) => ({
        id: item.id,
        name: item.name,
        storeIds: item.stores.map((store) => store.id),
      })),
      sampleProducts: products.slice(0, 5).map((item) => ({
        id: item.id,
        name: item.name,
        defaultStockId: item.defaultStockId ?? null,
        unitPrice:
          item.defaultStock?.sellingPrice ??
          item.stocks.find((stock) => stock.storeId === (session.storeId ?? business?.defaultStoreId))?.sellingPrice ??
          item.stocks[0]?.sellingPrice ??
          null,
      })),
    });
  };

  void execute().catch(next);
});
