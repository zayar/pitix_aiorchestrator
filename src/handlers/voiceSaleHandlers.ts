import type { Response } from "express";
import type {
  CatalogSnapshot,
  CreateSaleRequestBody,
  SavedCartListRequestBody,
  SavedCartListResponse,
  SavedCartMutationRequestBody,
  SavedCartMutationResponse,
  SavedVoiceCartDocument,
  VoiceSaleProcessResponse,
  VoiceSaleRequestContext,
} from "../types/contracts.js";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { AppError } from "../utils/errors.js";
import { config } from "../config/index.js";
import { createSpeechRecognitionService } from "../services/SpeechRecognitionService.js";
import { createLlmSaleParserService } from "../services/LlmSaleParserService.js";
import { PitiXBackendAdapter } from "../adapters/PitiXBackendAdapter.js";
import { savedCartFirestoreService } from "../services/SavedCartFirestoreService.js";
import { buildCatalogBiasPhrases } from "../utils/catalogBias.js";
import { logger } from "../utils/logger.js";

const speechRecognitionService = createSpeechRecognitionService();
const llmSaleParserService = createLlmSaleParserService();
const pitixBackendAdapter = new PitiXBackendAdapter();

const readAccessToken = (req: RequestWithContext): string =>
  String(req.headers.authorization ?? req.headers.token ?? "").replace(/^Bearer\s+/i, "").trim();

const readRefreshToken = (req: RequestWithContext): string | undefined =>
  String(req.body?.refreshToken ?? req.headers["x-refresh-token"] ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim() || undefined;

type RequestWithAudio = RequestWithContext & {
  file?: Express.Multer.File;
};

type ResolvedAudioPayload = {
  audioBase64: string;
  mimeType: string;
  source: "multipart" | "json";
  sizeBytes?: number;
};

const toSizeBucket = (sizeBytes?: number): string | undefined => {
  if (!Number.isFinite(sizeBytes)) {
    return undefined;
  }

  if ((sizeBytes ?? 0) < 128 * 1024) return "<128kb";
  if ((sizeBytes ?? 0) < 512 * 1024) return "128-512kb";
  if ((sizeBytes ?? 0) < 1024 * 1024) return "512kb-1mb";
  return ">1mb";
};

const parseStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return [];
  }

  if (rawValue.startsWith("[")) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry ?? "").trim()).filter(Boolean);
      }
    } catch (_error) {
      // Fall through to comma-separated parsing.
    }
  }

  return rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return value;
  }
};

const readClientBiasPhrases = (req: RequestWithContext): string[] =>
  parseStringList(parseJsonValue(req.body?.biasPhrases));

const readClientCatalogSnapshot = (req: RequestWithContext): CatalogSnapshot | null => {
  const parsed = parseJsonValue(req.body?.catalogSnapshot);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const source = parsed as Record<string, unknown>;
  const customers = Array.isArray(source.customers)
    ? source.customers.reduce<CatalogSnapshot["customers"]>((acc, row) => {
        if (!row || typeof row !== "object") {
          return acc;
        }
        const value = row as Record<string, unknown>;
        const id = String(value.id ?? "").trim();
        const name = String(value.name ?? "").trim();
        if (!id || !name) {
          return acc;
        }

        acc.push({
          id,
          name,
          identifier: String(value.identifier ?? "").trim() || null,
          phone: String(value.phone ?? "").trim() || null,
          email: String(value.email ?? "").trim() || null,
        });
        return acc;
      }, [])
    : [];

  const products = Array.isArray(source.products)
    ? source.products.reduce<CatalogSnapshot["products"]>((acc, row) => {
        if (!row || typeof row !== "object") {
          return acc;
        }
        const value = row as Record<string, unknown>;
        const id = String(value.id ?? "").trim();
        const name = String(value.name ?? "").trim();
        if (!id || !name) {
          return acc;
        }

        const unitPrice = Number(value.unitPrice ?? 0);
        const currentStock = Number(value.currentStock ?? 0);

        acc.push({
          id,
          name,
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
          stockId: String(value.stockId ?? "").trim() || null,
          currentStock: Number.isFinite(currentStock) ? currentStock : 0,
          trackInventory: Boolean(value.trackInventory),
        });
        return acc;
      }, [])
    : [];

  if (customers.length === 0 && products.length === 0) {
    return null;
  }

  const saleChannels = Array.isArray(source.saleChannels)
    ? source.saleChannels.reduce<CatalogSnapshot["saleChannels"]>((acc, row) => {
        if (!row || typeof row !== "object") {
          return acc;
        }
        const value = row as Record<string, unknown>;
        const name = String(value.name ?? "").trim();
        if (!name) {
          return acc;
        }

        acc.push({
          id: String(value.id ?? "").trim() || undefined,
          code: String(value.code ?? "").trim() || null,
          active: typeof value.active === "boolean" ? value.active : undefined,
          name,
          isDefault:
            typeof value.isDefault === "boolean"
              ? value.isDefault
              : typeof value.is_default === "boolean"
                ? value.is_default
                : undefined,
          type: String(value.type ?? "").trim() || null,
          storeId: String(value.storeId ?? value.store_id ?? "").trim() || null,
          storeName: String(value.storeName ?? value.store_name ?? "").trim() || null,
        });
        return acc;
      }, [])
    : [];

  return {
    currencyCode: String(source.currencyCode ?? "MMK").trim() || "MMK",
    defaultStoreId: String(source.defaultStoreId ?? "").trim() || null,
    saleChannels,
    customers,
    products,
  };
};

const readPrimaryLanguage = (req: RequestWithContext): string =>
  String(req.body?.language?.primary ?? req.body?.languagePrimary ?? "my-MM").trim() || "my-MM";

const readAdditionalLanguages = (req: RequestWithContext): string[] =>
  parseStringList(req.body?.language?.secondary ?? req.body?.languageSecondary);

const readTranscriptOverride = (req: RequestWithContext): string | undefined =>
  String(req.body?.debug?.transcriptOverride ?? req.body?.debugTranscriptOverride ?? "").trim() || undefined;

const readAudioPayload = (req: RequestWithAudio): ResolvedAudioPayload => {
  if (req.file?.buffer?.length) {
    return {
      audioBase64: req.file.buffer.toString("base64"),
      mimeType: String(req.file.mimetype || "audio/m4a").trim() || "audio/m4a",
      source: "multipart",
      sizeBytes: req.file.size,
    };
  }

  return {
    audioBase64: String(req.body?.audio?.base64 ?? "").trim(),
    mimeType: String(req.body?.audio?.mimeType ?? "audio/m4a").trim() || "audio/m4a",
    source: "json",
  };
};

const logVoiceUpload = (req: RequestWithAudio, route: "recognize" | "process", audio: ResolvedAudioPayload) => {
  if (!config.pitixDebugLogs) {
    return;
  }

  logger.info("Voice sale audio received", {
    requestId: req.requestId,
    route,
    source: audio.source,
    hasFile: Boolean(req.file?.buffer?.length),
    mimeType: audio.mimeType,
    fileSizeBucket: toSizeBucket(audio.sizeBytes),
    hasBusinessId: Boolean(String(req.body?.businessId ?? "").trim()),
    hasUserId: Boolean(String(req.body?.userId ?? "").trim()),
    hasStoreId: Boolean(String(req.body?.storeId ?? "").trim()),
    hasRefreshToken: Boolean(readRefreshToken(req)),
    hasCatalogSnapshot: Boolean(readClientCatalogSnapshot(req)),
    clientBiasPhraseCount: readClientBiasPhrases(req).length,
  });
};

const buildVoiceContext = (req: RequestWithContext): VoiceSaleRequestContext => {
  const businessId = String(req.body?.businessId ?? "").trim();
  const userId = String(req.body?.userId ?? "").trim();
  const token = readAccessToken(req);
  const saleChannelName =
    typeof req.body?.saleChannel === "string"
      ? String(req.body.saleChannel).trim()
      : String(req.body?.saleChannel?.name ?? "").trim();

  if (!businessId || !userId) {
    throw new AppError("businessId and userId are required.", {
      statusCode: 400,
      code: "missing_context",
    });
  }
  if (!token) {
    throw new AppError("PitiX access token is required in the Authorization header.", {
      statusCode: 401,
      code: "missing_access_token",
    });
  }

  return {
    requestId: req.requestId,
    businessId,
    storeId: String(req.body?.storeId ?? "").trim() || undefined,
    storeName: String(req.body?.storeName ?? "").trim() || undefined,
    userId,
    userName: String(req.body?.userName ?? "").trim() || undefined,
    token,
    refreshToken: readRefreshToken(req),
    saleChannel: saleChannelName ? { name: saleChannelName } : undefined,
  };
};

const buildProcessResponse = (params: {
  requestId: string;
  transcript: string;
  draft: VoiceSaleProcessResponse["draft"];
  speechProvider: string;
  parserProvider: string;
  languageCode: string;
  lowConfidence: boolean;
}): VoiceSaleProcessResponse => ({
  requestId: params.requestId,
  transcript: params.transcript,
  draft: params.draft,
  meta: {
    speechProvider: params.speechProvider,
    parserProvider: params.parserProvider,
    recognizedLanguage: params.languageCode,
    lowConfidence: params.lowConfidence,
    createdAt: new Date().toISOString(),
  },
});

const buildSpeechRecognitionInput = (params: {
  context: VoiceSaleRequestContext;
  audioBase64: string;
  mimeType: string;
  primaryLanguage: string;
  additionalLanguages: string[];
  transcriptOverride?: string;
  biasPhrases?: string[];
}) => ({
  requestId: params.context.requestId,
  audioBase64: params.audioBase64,
  mimeType: params.mimeType,
  primaryLanguage: params.primaryLanguage,
  additionalLanguages: params.additionalLanguages,
  transcriptOverride: params.transcriptOverride,
  biasPhrases: params.biasPhrases,
});

export const handleCatalog = async (req: RequestWithContext, res: Response) => {
  const context = buildVoiceContext(req);
  const catalog = await pitixBackendAdapter.fetchCatalog(context);
  res.json(catalog);
};

export const handleRecognize = async (req: RequestWithContext, res: Response) => {
  const requestWithAudio = req as RequestWithAudio;
  const audio = readAudioPayload(requestWithAudio);
  logVoiceUpload(requestWithAudio, "recognize", audio);
  const context = buildVoiceContext(req);
  const primaryLanguage = readPrimaryLanguage(req);
  const additionalLanguages = readAdditionalLanguages(req);
  const requestCatalog = readClientCatalogSnapshot(req);
  let biasPhrases = readClientBiasPhrases(req);

  if (biasPhrases.length === 0 && requestCatalog) {
    biasPhrases = buildCatalogBiasPhrases(requestCatalog);
  }

  if (biasPhrases.length === 0) {
    try {
      const catalog = await pitixBackendAdapter.fetchCatalog(context);
      biasPhrases = buildCatalogBiasPhrases(catalog);
    } catch (error) {
      logger.warn("PitiX catalog preload failed before recognize", {
        requestId: context.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const recognized = await speechRecognitionService.recognize(
    buildSpeechRecognitionInput({
      context,
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
      primaryLanguage,
      additionalLanguages,
      transcriptOverride: readTranscriptOverride(req),
      biasPhrases,
    }),
  );

  res.json({
    requestId: context.requestId,
    transcript: recognized.transcript,
    meta: {
      speechProvider: recognized.provider,
      recognizedLanguage: recognized.languageCode,
      confidence: recognized.confidence,
      lowConfidence: recognized.lowConfidence,
      createdAt: new Date().toISOString(),
    },
  });
};

export const handleParse = async (req: RequestWithContext, res: Response) => {
  const context = buildVoiceContext(req);
  const transcript = String(req.body?.transcript ?? "").trim();
  if (!transcript) {
    throw new AppError("transcript is required.", { statusCode: 400, code: "missing_transcript" });
  }

  const catalog = readClientCatalogSnapshot(req) ?? (await pitixBackendAdapter.fetchCatalog(context));
  const draft = await llmSaleParserService.parse({
    requestId: context.requestId,
    transcript,
    catalog,
  });

  res.json(
    buildProcessResponse({
      requestId: context.requestId,
      transcript,
      draft,
      speechProvider: "transcript_only",
      parserProvider: draft.recommendedNextAction === "review_and_confirm" ? "hybrid_parser" : "hybrid_parser_review",
      languageCode: String(req.body?.language?.primary ?? "my-MM").trim() || "my-MM",
      lowConfidence: draft.confidence < 0.6,
    }),
  );
};

export const handleProcess = async (req: RequestWithContext, res: Response) => {
  const requestWithAudio = req as RequestWithAudio;
  const audio = readAudioPayload(requestWithAudio);
  logVoiceUpload(requestWithAudio, "process", audio);
  const context = buildVoiceContext(req);
  const primaryLanguage = readPrimaryLanguage(req);
  const additionalLanguages = readAdditionalLanguages(req);
  const requestCatalog = readClientCatalogSnapshot(req);
  const catalog = requestCatalog ?? (await pitixBackendAdapter.fetchCatalog(context));
  const biasPhrases = readClientBiasPhrases(req).length > 0
    ? readClientBiasPhrases(req)
    : buildCatalogBiasPhrases(catalog);

  const recognized = await speechRecognitionService.recognize(
    buildSpeechRecognitionInput({
      context,
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
      primaryLanguage,
      additionalLanguages,
      transcriptOverride: readTranscriptOverride(req),
      biasPhrases,
    }),
  );
  const draft = await llmSaleParserService.parse({
    requestId: context.requestId,
    transcript: recognized.transcript,
    catalog,
  });

  logger.info("Voice sale process completed", {
    requestId: context.requestId,
    transcriptLength: recognized.transcript.length,
    lowConfidence: recognized.lowConfidence,
    draftConfidence: draft.confidence,
    biasPhraseCount: biasPhrases.length,
  });

  res.json(
    buildProcessResponse({
      requestId: context.requestId,
      transcript: recognized.transcript,
      draft,
      speechProvider: recognized.provider,
      parserProvider: "hybrid_sale_parser",
      languageCode: recognized.languageCode,
      lowConfidence: recognized.lowConfidence || draft.confidence < 0.6,
    }),
  );
};

export const handleCreate = async (req: RequestWithContext, res: Response) => {
  const context = buildVoiceContext(req);
  const body = req.body as CreateSaleRequestBody;
  if (!body?.draft) {
    throw new AppError("draft is required.", { statusCode: 400, code: "missing_draft" });
  }

  const response = await pitixBackendAdapter.createSale(context, body);
  res.json(response);
};

const ensureSavedCartAccess = async (context: VoiceSaleRequestContext) => {
  if (!context.storeId) {
    throw new AppError("storeId is required for saved carts.", {
      statusCode: 400,
      code: "missing_store_id",
    });
  }

  await pitixBackendAdapter.pingBusiness(context, context.requestId);
};

export const handleSavedCartList = async (req: RequestWithContext, res: Response) => {
  const context = buildVoiceContext(req);
  const body = req.body as SavedCartListRequestBody;
  await ensureSavedCartAccess(context);

  const carts = await savedCartFirestoreService.list({
    businessId: context.businessId,
    storeId: context.storeId!,
    firestoreDb: body?.firestoreDb,
  });

  const response: SavedCartListResponse = {
    requestId: context.requestId,
    carts,
  };

  res.json(response);
};

export const handleSavedCartCreate = async (req: RequestWithContext, res: Response) => {
  const context = buildVoiceContext(req);
  const body = req.body as SavedCartMutationRequestBody;
  if (!body?.cart) {
    throw new AppError("cart is required.", {
      statusCode: 400,
      code: "missing_cart",
    });
  }

  await ensureSavedCartAccess(context);
  const cart = await savedCartFirestoreService.createOrUpdate({
    businessId: context.businessId,
    storeId: context.storeId!,
    cart: body.cart as SavedVoiceCartDocument,
    firestoreDb: body?.firestoreDb,
  });

  const response: SavedCartMutationResponse = {
    requestId: context.requestId,
    cart,
  };

  res.json(response);
};

export const handleSavedCartUpdate = async (req: RequestWithContext, res: Response) => {
  const context = buildVoiceContext(req);
  const body = req.body as SavedCartMutationRequestBody;
  if (!body?.cart) {
    throw new AppError("cart is required.", {
      statusCode: 400,
      code: "missing_cart",
    });
  }

  await ensureSavedCartAccess(context);
  const cart = await savedCartFirestoreService.createOrUpdate({
    businessId: context.businessId,
    storeId: context.storeId!,
    cart: body.cart as SavedVoiceCartDocument,
    firestoreDb: body?.firestoreDb,
  });

  const response: SavedCartMutationResponse = {
    requestId: context.requestId,
    cart,
  };

  res.json(response);
};
