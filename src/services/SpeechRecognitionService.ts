import { VertexAI } from "@google-cloud/vertexai";
import { config } from "../config/index.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { parseJsonObject } from "../utils/json.js";

export type SpeechRecognitionInput = {
  requestId: string;
  audioBase64: string;
  mimeType: string;
  primaryLanguage: string;
  additionalLanguages: string[];
  biasPhrases?: string[];
  commands?: string[];
  transcriptOverride?: string;
};

export type SpeechRecognitionOutput = {
  transcript: string;
  languageCode: string;
  provider: string;
  confidence: number;
  lowConfidence: boolean;
};

export interface SpeechRecognitionService {
  recognize(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput>;
}

type ModelPayload = {
  transcript?: string;
  languageCode?: string;
  confidence?: number | string;
};

const LIVE_PROVIDER = "gemini_live_stt";
const FALLBACK_PROVIDER = "gemini_audio_transcription";
const DEFAULT_PRIMARY_LANGUAGE = "my-MM";
const DEFAULT_SECONDARY_LANGUAGE = "en-US";
const DEFAULT_TIMEOUT_MS = 18000;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.62;
const MAX_BIAS_PHRASES = 1200;
const DEFAULT_COMMANDS = ["add sale", "sale order", "customer", "cash", "take away", "ထည့်", "ရောင်း", "ဖောက်သည်"];

const liveClientLocation =
  String(process.env.VOICE_REALTIME_VERTEX_LOCATION ?? "global").trim() || "global";
const liveModelName =
  String(process.env.VOICE_REALTIME_MODEL ?? "gemini-2.0-flash-live-preview-04-09").trim() ||
  "gemini-2.0-flash-live-preview-04-09";
const fallbackModelName =
  String(process.env.VOICE_RECOGNITION_FALLBACK_MODEL ?? config.vertexSttModel).trim() ||
  config.vertexSttModel;

const normalizeLanguageCode = (value: string): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_PRIMARY_LANGUAGE;

  switch (raw.toLowerCase()) {
    case "en":
    case "en-us":
      return "en-US";
    case "my":
    case "my-mm":
      return "my-MM";
    default:
      return raw;
  }
};

const normalizeAdditionalLanguageCodes = (
  value: string[] | undefined,
  primaryLanguageCode: string,
): string[] => {
  const seeds = Array.isArray(value) ? value : [];
  const collected = new Set<string>();

  for (const candidate of seeds) {
    const normalized = normalizeLanguageCode(candidate);
    if (normalized && normalized !== primaryLanguageCode) {
      collected.add(normalized);
    }
  }

  if (primaryLanguageCode !== DEFAULT_SECONDARY_LANGUAGE) {
    collected.add(DEFAULT_SECONDARY_LANGUAGE);
  }
  if (primaryLanguageCode !== DEFAULT_PRIMARY_LANGUAGE) {
    collected.add(DEFAULT_PRIMARY_LANGUAGE);
  }

  return Array.from(collected).slice(0, 4);
};

const normalizeAudio = (rawValue: string): string =>
  String(rawValue ?? "")
    .replace(/^data:[^,]+,/, "")
    .replace(/\s+/g, "")
    .trim();

const clampTranscript = (value: string): string => {
  const trimmed = String(value ?? "").trim();
  return trimmed.length <= 1800 ? trimmed : trimmed.slice(0, 1800);
};

const sanitizePhrases = (phrases: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const raw of phrases) {
    const phrase = String(raw ?? "").trim();
    if (!phrase) {
      continue;
    }

    const key = phrase.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(phrase);
    if (output.length >= MAX_BIAS_PHRASES) {
      break;
    }
  }

  return output;
};

const buildBiasPhraseList = (input: SpeechRecognitionInput): string[] =>
  sanitizePhrases([...(input.biasPhrases ?? []), ...(input.commands ?? DEFAULT_COMMANDS)]);

const toConfidence = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
  }

  return null;
};

const confidenceThreshold = (): number => {
  const raw = Number(
    process.env.VOICE_RECOGNITION_LOW_CONFIDENCE_THRESHOLD ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  );
  if (!Number.isFinite(raw) || raw <= 0 || raw >= 1) {
    return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  }
  return raw;
};

const mergeTranscriptionPieces = (pieces: string[]): string => {
  let transcript = "";

  for (const piece of pieces) {
    const text = clampTranscript(piece);
    if (!text) continue;

    if (!transcript) {
      transcript = text;
      continue;
    }

    if (text === transcript || transcript.includes(text)) {
      continue;
    }

    if (text.length > transcript.length && text.includes(transcript)) {
      transcript = text;
      continue;
    }

    transcript = `${transcript} ${text}`.replace(/\s+/g, " ").trim();
  }

  return clampTranscript(transcript);
};

const toTranscriptOverride = (input: SpeechRecognitionInput): SpeechRecognitionOutput | null => {
  const transcript = String(input.transcriptOverride ?? "").trim();
  if (!transcript) {
    return null;
  }

  return {
    transcript,
    languageCode: normalizeLanguageCode(input.primaryLanguage),
    provider: "stub_override",
    confidence: 1,
    lowConfidence: false,
  };
};

class StubSpeechRecognitionService implements SpeechRecognitionService {
  async recognize(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput> {
    const override = toTranscriptOverride(input);
    if (override) {
      return override;
    }

    throw new AppError(
      "STT provider is set to stub. Use typed transcript parsing or send debug.transcriptOverride for backend testing.",
      { statusCode: 400, code: "speech_provider_not_configured" },
    );
  }
}

class GeminiSpeechRecognitionService implements SpeechRecognitionService {
  private getVertexClient(): VertexAI {
    return new VertexAI({
      ...(config.gcpProjectId ? { project: config.gcpProjectId } : {}),
      location: config.vertexRegion,
    });
  }

  private async transcribeWithLiveApi(params: {
    audioBase64: string;
    mimeType: string;
    primaryLanguageCode: string;
    additionalLanguageCodes: string[];
    biasPhrases: string[];
  }): Promise<string> {
    const timeoutMs = Math.max(
      3000,
      Number(process.env.VOICE_RECOGNITION_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    );

    const genaiModule = await import("@google/genai");
    const ai = new genaiModule.GoogleGenAI({
      vertexai: true,
      ...(config.gcpProjectId ? { project: config.gcpProjectId } : {}),
      location: liveClientLocation,
    });

    let session: any = null;

    try {
      const transcription = await Promise.race([
        new Promise<string>(async (resolve, reject) => {
          const chunks: string[] = [];
          let completed = false;

          const finish = (value: string) => {
            if (completed) return;
            completed = true;
            resolve(value);
          };

          const fail = (error: unknown) => {
            if (completed) return;
            completed = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          };

          try {
            session = await ai.live.connect({
              model: liveModelName,
              config: {
                responseModalities: [genaiModule.Modality.TEXT],
                inputAudioTranscription: {},
                temperature: 0,
                maxOutputTokens: 128,
                systemInstruction: [
                  "You are a real-time speech-to-text transcriber for retail sales capture.",
                  "Transcribe the speaker exactly and preserve product names, customer names, and quantities.",
                  "Support mixed Myanmar and English in the same utterance.",
                  `Preferred language order: ${[
                    params.primaryLanguageCode,
                    ...params.additionalLanguageCodes,
                  ].join(", ")}`,
                  "Do not translate. Do not summarize. Output faithful transcript text only.",
                  params.biasPhrases.length > 0
                    ? `Bias phrases (prefer these spellings): ${params.biasPhrases.slice(0, 300).join(", ")}`
                    : "",
                ].join("\n"),
              },
              callbacks: {
                onmessage: (message: unknown) => {
                  const part = String(
                    (message as {
                      serverContent?: {
                        inputTranscription?: { text?: string; finished?: boolean };
                        turnComplete?: boolean;
                      };
                    })?.serverContent?.inputTranscription?.text ?? "",
                  ).trim();
                  if (part) {
                    chunks.push(part);
                  }

                  const isFinished = Boolean(
                    (message as {
                      serverContent?: {
                        inputTranscription?: { finished?: boolean };
                        turnComplete?: boolean;
                      };
                    })?.serverContent?.inputTranscription?.finished,
                  );
                  const turnComplete = Boolean(
                    (message as { serverContent?: { turnComplete?: boolean } })?.serverContent?.turnComplete,
                  );

                  if (isFinished || turnComplete) {
                    finish(mergeTranscriptionPieces(chunks));
                  }
                },
                onerror: (error: unknown) => fail(error),
                onclose: () => finish(mergeTranscriptionPieces(chunks)),
              },
            });

            session?.sendRealtimeInput?.({
              audio: {
                data: params.audioBase64,
                mimeType: params.mimeType || "audio/wav",
              },
            });
            session?.sendRealtimeInput?.({ audioStreamEnd: true });
            session?.sendClientContent?.({ turnComplete: true });
          } catch (error) {
            fail(error);
          }
        }),
        new Promise<string>((_resolve, reject) => {
          setTimeout(() => reject(new Error("live_transcription_timeout")), timeoutMs);
        }),
      ]);

      return clampTranscript(transcription);
    } finally {
      try {
        session?.close?.();
      } catch {
        // Ignore close failures.
      }
    }
  }

  private async transcribeWithFallbackModel(params: {
    audioBase64: string;
    mimeType: string;
    primaryLanguageCode: string;
    additionalLanguageCodes: string[];
    biasPhrases: string[];
  }): Promise<{ transcript: string; languageCode: string; confidence: number | null }> {
    const model = this.getVertexClient().getGenerativeModel({
      model: fallbackModelName,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      } as never,
    });

    const response = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Transcribe this speech audio for retail sales capture.",
                'Return strict JSON only with this shape: {"transcript":"string","languageCode":"string","confidence":0.0}',
                "Rules:",
                "- Keep names exactly as spoken.",
                "- Keep quantity expressions (e.g., 3, three, ၃).",
                "- Handle Myanmar and English mixed speech.",
                `- Primary language: ${params.primaryLanguageCode}`,
                `- Additional languages: ${params.additionalLanguageCodes.join(", ") || "none"}`,
                params.biasPhrases.length > 0
                  ? `- bias_phrases: ${params.biasPhrases.slice(0, 400).join(", ")}`
                  : "",
              ].join("\n"),
            },
            {
              inlineData: {
                mimeType: params.mimeType || "audio/wav",
                data: params.audioBase64,
              },
            },
          ],
        },
      ],
    } as never);

    const parts = response.response.candidates?.[0]?.content?.parts ?? [];
    const rawText = parts
      .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();

    const payload = parseJsonObject<ModelPayload>(rawText);
    return {
      transcript: clampTranscript(String(payload?.transcript ?? rawText)),
      languageCode: normalizeLanguageCode(String(payload?.languageCode ?? params.primaryLanguageCode)),
      confidence: toConfidence(payload?.confidence),
    };
  }

  async recognize(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput> {
    const override = toTranscriptOverride(input);
    if (override) {
      return override;
    }

    const audioBase64 = normalizeAudio(input.audioBase64);
    if (!audioBase64) {
      throw new AppError("Audio payload is required.", { statusCode: 400, code: "missing_audio" });
    }

    const mimeType = String(input.mimeType || "audio/m4a").trim() || "audio/m4a";
    const primaryLanguageCode = normalizeLanguageCode(input.primaryLanguage || DEFAULT_PRIMARY_LANGUAGE);
    const additionalLanguageCodes = normalizeAdditionalLanguageCodes(
      input.additionalLanguages,
      primaryLanguageCode,
    );
    const biasPhrases = buildBiasPhraseList(input);

    let transcript = "";
    let confidence: number | null = null;
    let languageCode = primaryLanguageCode;
    let provider = LIVE_PROVIDER;

    try {
      transcript = await this.transcribeWithLiveApi({
        audioBase64,
        mimeType,
        primaryLanguageCode,
        additionalLanguageCodes,
        biasPhrases,
      });
    } catch (error) {
      logger.warn("Live voice transcription failed, falling back", {
        requestId: input.requestId,
        provider: LIVE_PROVIDER,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!transcript) {
      try {
        const fallback = await this.transcribeWithFallbackModel({
          audioBase64,
          mimeType,
          primaryLanguageCode,
          additionalLanguageCodes,
          biasPhrases,
        });
        transcript = fallback.transcript;
        confidence = fallback.confidence;
        languageCode = fallback.languageCode;
        provider = FALLBACK_PROVIDER;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/infer your project|project id/i.test(message)) {
          throw new AppError(
            "Speech recognition is not configured. Set GCP_PROJECT_ID or let Cloud Run provide the project automatically.",
            { statusCode: 500, code: "stt_provider_misconfigured" },
          );
        }
        throw error;
      }
    }

    const finalConfidence = confidence ?? (transcript ? 0.78 : 0);
    const lowConfidence = Boolean(
      !transcript || (confidence !== null && confidence < confidenceThreshold()),
    );

    if (!transcript) {
      throw new AppError("Speech recognition returned an empty transcript.", {
        statusCode: 502,
        code: "empty_transcript",
      });
    }

    logger.info("Audio recognized", {
      requestId: input.requestId,
      provider,
      confidence: finalConfidence,
      transcriptLength: transcript.length,
      languageCode,
      lowConfidence,
      biasPhraseCount: biasPhrases.length,
    });

    return {
      transcript,
      languageCode,
      provider,
      confidence: finalConfidence,
      lowConfidence,
    };
  }
}

export const createSpeechRecognitionService = (): SpeechRecognitionService => {
  if (String(config.sttProvider).trim().toLowerCase() === "stub") {
    return new StubSpeechRecognitionService();
  }

  return new GeminiSpeechRecognitionService();
};
