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
  confidence?: number;
};

const normalizeAudio = (rawValue: string): string =>
  String(rawValue ?? "")
    .replace(/^data:[^,]+,/, "")
    .replace(/\s+/g, "")
    .trim();

class StubSpeechRecognitionService implements SpeechRecognitionService {
  async recognize(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput> {
    const transcript = String(input.transcriptOverride ?? "").trim();
    if (!transcript) {
      throw new AppError(
        "STT provider is set to stub. Use typed transcript parsing or send debug.transcriptOverride for backend testing.",
        { statusCode: 400, code: "speech_provider_not_configured" },
      );
    }

    return {
      transcript,
      languageCode: input.primaryLanguage,
      provider: "stub_override",
      confidence: 1,
      lowConfidence: false,
    };
  }
}

class VertexSpeechRecognitionService implements SpeechRecognitionService {
  private readonly vertex = new VertexAI({
    project: config.gcpProjectId,
    location: config.vertexRegion,
  });

  async recognize(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput> {
    if (!config.gcpProjectId) {
      throw new AppError("GCP_PROJECT_ID is required when STT_PROVIDER=vertex_gemini.", {
        statusCode: 500,
        code: "stt_provider_misconfigured",
      });
    }

    const audioBase64 = normalizeAudio(input.audioBase64);
    if (!audioBase64) {
      throw new AppError("Audio payload is required.", { statusCode: 400, code: "missing_audio" });
    }

    const model = this.vertex.getGenerativeModel({
      model: config.vertexSttModel,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      } as never,
    });

    const prompt = [
      "Transcribe this retail sales audio.",
      "Keep product names and customer names as spoken.",
      "Support Myanmar and English mixed speech.",
      "Return strict JSON only:",
      '{"transcript":"string","languageCode":"string","confidence":0.0}',
      `Primary language: ${input.primaryLanguage}`,
      `Additional languages: ${input.additionalLanguages.join(", ") || "none"}`,
    ].join("\n");

    const response = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: input.mimeType || "audio/m4a",
                data: audioBase64,
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
    const transcript = String(payload?.transcript ?? "").trim();
    if (!transcript) {
      throw new AppError("Vertex STT returned an empty transcript.", {
        statusCode: 502,
        code: "empty_transcript",
      });
    }

    const confidence = Number.isFinite(Number(payload?.confidence)) ? Number(payload?.confidence) : 0.66;

    logger.info("Audio recognized", {
      requestId: input.requestId,
      provider: "vertex_gemini",
      confidence,
      transcriptLength: transcript.length,
      languageCode: String(payload?.languageCode ?? input.primaryLanguage),
    });

    return {
      transcript,
      languageCode: String(payload?.languageCode ?? input.primaryLanguage),
      provider: "vertex_gemini",
      confidence,
      lowConfidence: confidence < 0.6,
    };
  }
}

export const createSpeechRecognitionService = (): SpeechRecognitionService => {
  if (config.sttProvider === "vertex_gemini") {
    return new VertexSpeechRecognitionService();
  }
  return new StubSpeechRecognitionService();
};
