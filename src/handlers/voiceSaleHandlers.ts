import type { Response } from "express";
import type { CreateSaleRequestBody, VoiceSaleProcessResponse, VoiceSaleRequestContext } from "../types/contracts.js";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { AppError } from "../utils/errors.js";
import { createSpeechRecognitionService } from "../services/SpeechRecognitionService.js";
import { createLlmSaleParserService } from "../services/LlmSaleParserService.js";
import { PitiXBackendAdapter } from "../adapters/PitiXBackendAdapter.js";
import { logger } from "../utils/logger.js";

const speechRecognitionService = createSpeechRecognitionService();
const llmSaleParserService = createLlmSaleParserService();
const pitixBackendAdapter = new PitiXBackendAdapter();

const readAccessToken = (req: RequestWithContext): string =>
  String(req.headers.authorization ?? req.headers.token ?? "").replace(/^Bearer\s+/i, "").trim();

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

export const handleRecognize = async (req: RequestWithContext, res: Response) => {
  const context = buildVoiceContext(req);
  const audioBase64 = String(req.body?.audio?.base64 ?? "").trim();
  const mimeType = String(req.body?.audio?.mimeType ?? "audio/m4a").trim();
  const primaryLanguage = String(req.body?.language?.primary ?? "my-MM").trim() || "my-MM";
  const additionalLanguages = Array.isArray(req.body?.language?.secondary)
    ? req.body.language.secondary.map((entry: unknown) => String(entry ?? "").trim()).filter(Boolean)
    : [];

  const recognized = await speechRecognitionService.recognize({
    requestId: context.requestId,
    audioBase64,
    mimeType,
    primaryLanguage,
    additionalLanguages,
    transcriptOverride: String(req.body?.debug?.transcriptOverride ?? "").trim() || undefined,
  });

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

  const catalog = await pitixBackendAdapter.fetchCatalog(context);
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
  const context = buildVoiceContext(req);
  const audioBase64 = String(req.body?.audio?.base64 ?? "").trim();
  const mimeType = String(req.body?.audio?.mimeType ?? "audio/m4a").trim();
  const primaryLanguage = String(req.body?.language?.primary ?? "my-MM").trim() || "my-MM";
  const additionalLanguages = Array.isArray(req.body?.language?.secondary)
    ? req.body.language.secondary.map((entry: unknown) => String(entry ?? "").trim()).filter(Boolean)
    : [];

  const recognized = await speechRecognitionService.recognize({
    requestId: context.requestId,
    audioBase64,
    mimeType,
    primaryLanguage,
    additionalLanguages,
    transcriptOverride: String(req.body?.debug?.transcriptOverride ?? "").trim() || undefined,
  });

  const catalog = await pitixBackendAdapter.fetchCatalog(context);
  const draft = await llmSaleParserService.parse({
    requestId: context.requestId,
    transcript: recognized.transcript,
    catalog,
  });

  logger.info("Voice sale process completed", {
    requestId: context.requestId,
    transcript: recognized.transcript,
    lowConfidence: recognized.lowConfidence,
    draftConfidence: draft.confidence,
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
