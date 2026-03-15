import { VertexAI } from "@google-cloud/vertexai";
import { config } from "../config/index.js";
import type {
  CatalogSnapshot,
  DraftMatchedCustomer,
  DraftMatchedProduct,
  DraftSaleItem,
  ParsedSaleDraft,
} from "../types/contracts.js";
import { logger } from "../utils/logger.js";
import { parseJsonObject } from "../utils/json.js";
import { findBestEntityMatchByName } from "../utils/matching.js";
import {
  extractCustomerHint,
  normalizeVoiceText,
  parseSpokenQuantity,
  removeQuantityWords,
  splitItemSegments,
} from "../utils/voiceText.js";
import { buildRetailSaleParserPrompt } from "../prompts/retailSaleParserPrompt.js";

type ModelParsePayload = {
  customerPhrase?: string | null;
  items?: Array<{
    phrase?: string;
    quantity?: number;
  }>;
  notes?: string;
  confidence?: number;
};

export interface LlmSaleParserService {
  parse(params: {
    requestId: string;
    transcript: string;
    catalog: CatalogSnapshot;
  }): Promise<ParsedSaleDraft>;
}

const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value));

const buildMatchedCustomer = (
  customerName: string,
  customers: CatalogSnapshot["customers"],
): DraftMatchedCustomer | null => {
  const match = findBestEntityMatchByName(customerName, customers);
  if (!match.match || match.ambiguous) return null;
  return {
    id: match.match.id,
    name: match.match.name,
    identifier: match.match.identifier ?? null,
    confidence: clampConfidence(match.confidence),
    matchedText: customerName,
  };
};

const buildMatchedProduct = (
  phrase: string,
  products: CatalogSnapshot["products"],
): DraftMatchedProduct | null => {
  const match = findBestEntityMatchByName(phrase, products);
  if (!match.match || match.ambiguous) return null;
  return {
    id: match.match.id,
    name: match.match.name,
    confidence: clampConfidence(match.confidence),
    unitPrice: match.match.unitPrice,
    stockId: match.match.stockId ?? null,
    currentStock: match.match.currentStock ?? null,
    trackInventory: match.match.trackInventory,
    matchedText: phrase,
  };
};

const toDraftItem = (
  rawText: string,
  quantity: number,
  product: DraftMatchedProduct | null,
): DraftSaleItem => {
  const safeQuantity = quantity > 0 ? quantity : 1;
  const unitPrice = product?.unitPrice ?? 0;
  const warnings: string[] = [];
  if (!product) {
    warnings.push("Product match needs review.");
  }
  if (product && !product.stockId) {
    warnings.push("Matched product has no sale stock yet.");
  }

  return {
    rawText,
    quantity: safeQuantity,
    unitPrice,
    lineTotal: safeQuantity * unitPrice,
    product,
    warnings,
  };
};

const buildDraftFromPhrases = (params: {
  requestId: string;
  transcript: string;
  catalog: CatalogSnapshot;
  customerPhrase: string;
  itemPhrases: Array<{ phrase: string; quantity: number }>;
  parserProvider: string;
  baseConfidence: number;
}): ParsedSaleDraft => {
  const customer = params.customerPhrase
    ? buildMatchedCustomer(params.customerPhrase, params.catalog.customers)
    : null;

  const items = params.itemPhrases.map((entry) => {
    const product = buildMatchedProduct(entry.phrase, params.catalog.products);
    return toDraftItem(entry.phrase, entry.quantity, product);
  });

  const unmatchedPhrases = items
    .filter((item) => !item.product)
    .map((item) => item.rawText);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const warnings = items.flatMap((item) => item.warnings);

  if (!customer && params.customerPhrase) {
    warnings.push("Customer could not be matched confidently.");
  }
  if (items.length === 0) {
    warnings.push("No item phrases were found in the transcript.");
  }
  if (unmatchedPhrases.length > 0) {
    warnings.push("Some item phrases need manual confirmation.");
  }

  const matchedCount = items.filter((item) => item.product).length + (customer ? 1 : 0);
  const totalSignals = params.itemPhrases.length + (params.customerPhrase ? 1 : 0) || 1;
  const confidence = clampConfidence(
    matchedCount === 0
      ? params.baseConfidence * 0.4
      : (matchedCount / totalSignals) * 0.7 + params.baseConfidence * 0.3,
  );
  const matchedItems = items.filter((item) => item.product);
  const hasStrongMatchedCart =
    matchedItems.length > 0 &&
    unmatchedPhrases.length === 0 &&
    subtotal > 0 &&
    matchedItems.every((item) => (item.product?.confidence ?? 0) >= 0.8);
  const hasLowConfidenceMatchedItem = matchedItems.some((item) => (item.product?.confidence ?? 0) < 0.55);
  const needsClarification =
    items.length === 0 ||
    matchedItems.length === 0 ||
    subtotal <= 0 ||
    unmatchedPhrases.length > 0 ||
    (!hasStrongMatchedCart && hasLowConfidenceMatchedItem);

  logger.info("Parser draft ready", {
    requestId: params.requestId,
    parserProvider: params.parserProvider,
    customerMatched: Boolean(customer),
    matchedItemCount: matchedItems.length,
    itemCount: items.length,
    confidence,
    unmatchedCount: unmatchedPhrases.length,
    subtotal,
    needsClarification,
  });

  return {
    transcript: params.transcript,
    customer,
    items,
    subtotal,
    currencyCode: params.catalog.currencyCode || "MMK",
    warnings: Array.from(new Set(warnings)),
    unmatchedPhrases,
    confidence,
    needsClarification,
    recommendedNextAction: needsClarification ? "review_and_clarify" : "review_and_confirm",
  };
};

class HybridSaleParserService implements LlmSaleParserService {
  private readonly vertex =
    config.llmProvider === "vertex_gemini" && config.gcpProjectId
      ? new VertexAI({
          project: config.gcpProjectId,
          location: config.vertexRegion,
        })
      : null;

  async parse(params: {
    requestId: string;
    transcript: string;
    catalog: CatalogSnapshot;
  }): Promise<ParsedSaleDraft> {
    const transcript = String(params.transcript ?? "").trim();
    const heuristic = this.parseHeuristically(params.requestId, transcript, params.catalog);
    if (config.llmProvider !== "vertex_gemini" || !this.vertex) {
      return heuristic;
    }

    try {
      const model = this.vertex.getGenerativeModel({
        model: config.vertexModel,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 768,
          responseMimeType: "application/json",
        } as never,
      });

      const response = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildRetailSaleParserPrompt({
                  transcript,
                  customerNames: params.catalog.customers.map((customer) => customer.name),
                  productNames: params.catalog.products.map((product) => product.name),
                }),
              },
            ],
          },
        ],
      } as never);

      const rawText = (response.response.candidates?.[0]?.content?.parts ?? [])
        .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();

      const payload = parseJsonObject<ModelParsePayload>(rawText);
      if (!payload) {
        return heuristic;
      }

      const customerPhrase = String(payload.customerPhrase ?? "").trim();
      const itemPhrases =
        payload.items
          ?.map((item) => ({
            phrase: String(item.phrase ?? "").trim(),
            quantity: Number(item.quantity ?? 1) || 1,
          }))
          .filter((item) => item.phrase) ?? [];

      if (itemPhrases.length === 0) {
        return heuristic;
      }

      return buildDraftFromPhrases({
        requestId: params.requestId,
        transcript,
        catalog: params.catalog,
        customerPhrase,
        itemPhrases,
        parserProvider: "vertex_gemini",
        baseConfidence: clampConfidence(Number(payload.confidence ?? 0.7)),
      });
    } catch (error) {
      logger.warn("Vertex parser failed, falling back to heuristic parser", {
        requestId: params.requestId,
        error: String(error),
      });
      return heuristic;
    }
  }

  private parseHeuristically(requestId: string, transcript: string, catalog: CatalogSnapshot): ParsedSaleDraft {
    const customerPhrase = extractCustomerHint(transcript);
    const itemPhrases = splitItemSegments(transcript).map((segment) => {
      const quantity = parseSpokenQuantity(segment) ?? 1;
      return {
        phrase: removeQuantityWords(segment) || normalizeVoiceText(segment),
        quantity,
      };
    });

    return buildDraftFromPhrases({
      requestId,
      transcript,
      catalog,
      customerPhrase,
      itemPhrases,
      parserProvider: "heuristic",
      baseConfidence: 0.62,
    });
  }
}

export const createLlmSaleParserService = (): LlmSaleParserService => new HybridSaleParserService();
