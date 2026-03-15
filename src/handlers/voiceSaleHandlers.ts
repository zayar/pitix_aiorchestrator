import type { Response } from "express";
import type { CreateSaleRequestBody, VoiceSaleProcessResponse, VoiceSaleRequestContext } from "../types/contracts.js";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { AppError } from "../utils/errors.js";
import { config } from "../config/index.js";
import { createSpeechRecognitionService } from "../services/SpeechRecognitionService.js";
import { createLlmSaleParserService } from "../services/LlmSaleParserService.js";
import { PitiXBackendAdapter } from "../adapters/PitiXBackendAdapter.js";
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

export const handleRecognize = async (req: RequestWithContext, res: Response) => {
  const requestWithAudio = req as RequestWithAudio;
  const audio = readAudioPayload(requestWithAudio);
  logVoiceUpload(requestWithAudio, "recognize", audio);
  const context = buildVoiceContext(req);
  const primaryLanguage = readPrimaryLanguage(req);
  const additionalLanguages = readAdditionalLanguages(req);

  const recognized = await speechRecognitionService.recognize({
    requestId: context.requestId,
    audioBase64: audio.audioBase64,
    mimeType: audio.mimeType,
    primaryLanguage,
    additionalLanguages,
    transcriptOverride: readTranscriptOverride(req),
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
  const requestWithAudio = req as RequestWithAudio;
  const audio = readAudioPayload(requestWithAudio);
  logVoiceUpload(requestWithAudio, "process", audio);
  const context = buildVoiceContext(req);
  const primaryLanguage = readPrimaryLanguage(req);
  const additionalLanguages = readAdditionalLanguages(req);

  const recognized = await speechRecognitionService.recognize({
    requestId: context.requestId,
    audioBase64: audio.audioBase64,
    mimeType: audio.mimeType,
    primaryLanguage,
    additionalLanguages,
    transcriptOverride: readTranscriptOverride(req),
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
