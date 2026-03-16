import { VertexAI } from "@google-cloud/vertexai";
import { config } from "../config/index.js";
import type {
  CatalogSnapshot,
  CustomerMatchCandidate,
  CustomerMatchInfo,
  DraftMatchedCustomer,
  DraftMatchedProduct,
  DraftSaleItem,
  ParsedSaleDraft,
} from "../types/contracts.js";
import { logger } from "../utils/logger.js";
import { parseJsonObject } from "../utils/json.js";
import {
  findBestEntityMatchByName,
  normalizeNameForMatching,
  rankEntityMatchesByName,
} from "../utils/matching.js";
import {
  extractCustomerHint,
  extractVoiceLineCandidates,
  normalizeVoiceText,
  parseSpokenQuantity,
  removeQuantityWords,
  splitItemSegments,
  stripCustomerTail,
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

const uniqueNames = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));
const CUSTOMER_PREFIX_MARKERS = new Set(["customer", "ဖောက်သည်", "ဖေါက်သည်"]);
const CUSTOMER_SUFFIX_MARKERS = new Set(["for", "to"]);
const MYANMAR_FOR_MARKER = "အတွက်";

const toTimeScore = (value?: string | null): number => {
  const time = Date.parse(String(value ?? "").trim());
  if (!Number.isFinite(time) || time <= 0) {
    return 0;
  }
  return time;
};

const toCustomerCandidate = (
  customer: CatalogSnapshot["customers"][number],
  confidence?: number,
  matchReason?: string,
): CustomerMatchCandidate => ({
  id: customer.id,
  name: customer.name,
  identifier: customer.identifier ?? null,
  phone: customer.phone ?? null,
  email: customer.email ?? null,
  createdAt: customer.createdAt ?? null,
  updatedAt: customer.updatedAt ?? null,
  branchName: customer.branchName ?? null,
  companyName: customer.companyName ?? null,
  lastVisitAt: customer.lastVisitAt ?? null,
  purchaseCount: customer.purchaseCount ?? null,
  totalSpend: customer.totalSpend ?? null,
  confidence: confidence ?? null,
  matchReason: matchReason ?? null,
});

const toMatchedCustomer = (
  customer: CatalogSnapshot["customers"][number],
  matchedText: string,
  confidence: number,
): DraftMatchedCustomer => ({
  id: customer.id,
  name: customer.name,
  identifier: customer.identifier ?? null,
  phone: customer.phone ?? null,
  email: customer.email ?? null,
  createdAt: customer.createdAt ?? null,
  updatedAt: customer.updatedAt ?? null,
  confidence: clampConfidence(confidence),
  matchedText,
});

const getCustomerSignal = (customer: CatalogSnapshot["customers"][number], spokenName: string): number => {
  const normalizedSpoken = normalizeVoiceText(spokenName).replace(/\D/g, "");
  const phoneDigits = normalizeVoiceText(String(customer.phone ?? "")).replace(/\D/g, "");
  const identifier = normalizeNameForMatching(String(customer.identifier ?? ""));
  const normalizedName = normalizeNameForMatching(customer.name);
  const normalizedSpokenName = normalizeNameForMatching(spokenName);

  let score = 0;
  if (normalizedName && normalizedSpokenName && normalizedName === normalizedSpokenName) {
    score += 1;
  }
  if (normalizedSpoken && phoneDigits && phoneDigits.includes(normalizedSpoken)) {
    score += 0.35;
  }
  if (identifier && normalizeNameForMatching(spokenName).includes(identifier)) {
    score += 0.22;
  }
  if (customer.totalSpend) {
    score += Math.min(Number(customer.totalSpend) / 1000000, 0.08);
  }
  if (customer.purchaseCount) {
    score += Math.min(Number(customer.purchaseCount) / 100, 0.05);
  }
  if (customer.lastVisitAt || customer.updatedAt) {
    score += 0.04;
  }
  if (customer.createdAt) {
    score += 0.02;
  }
  return score;
};

const rankCustomerCandidates = (
  spokenName: string,
  customers: CatalogSnapshot["customers"],
): Array<{ customer: CatalogSnapshot["customers"][number]; score: number; exactNormalizedMatch: boolean; matchReason: string }> => {
  const ranked = rankEntityMatchesByName(spokenName, customers);
  return ranked
    .map((entry) => {
      const signalBoost = getCustomerSignal(entry.entity, spokenName);
      const score = clampConfidence(entry.score + signalBoost * 0.1);
      const matchReason = entry.exactNormalizedMatch
        ? "Same customer name"
        : entry.entity.phone && normalizeVoiceText(spokenName).replace(/\D/g, "")
            && normalizeVoiceText(String(entry.entity.phone)).replace(/\D/g, "").includes(normalizeVoiceText(spokenName).replace(/\D/g, ""))
          ? "Phone matches spoken detail"
          : entry.entity.identifier && normalizeNameForMatching(spokenName).includes(normalizeNameForMatching(String(entry.entity.identifier)))
            ? "Member code matches spoken detail"
            : "Similar customer name";

      return {
        customer: entry.entity,
        score,
        exactNormalizedMatch: entry.exactNormalizedMatch,
        matchReason,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const rightRecent = Math.max(
        toTimeScore(right.customer.lastVisitAt),
        toTimeScore(right.customer.updatedAt),
        toTimeScore(right.customer.createdAt),
      );
      const leftRecent = Math.max(
        toTimeScore(left.customer.lastVisitAt),
        toTimeScore(left.customer.updatedAt),
        toTimeScore(left.customer.createdAt),
      );
      return rightRecent - leftRecent;
    });
};

const buildCustomerMatchInfo = (
  customerName: string,
  customers: CatalogSnapshot["customers"],
): { customer: DraftMatchedCustomer | null; customerMatch: CustomerMatchInfo } => {
  const spokenName = String(customerName ?? "").trim();
  if (!spokenName) {
    return {
      customer: null,
      customerMatch: {
        state: "no_match",
        spokenName: null,
        helperText: "No customer selected",
        confidence: null,
        suggestedMatches: [],
        allMatches: [],
      },
    };
  }

  const normalizedSpokenName = normalizeNameForMatching(spokenName);
  const exactMatches = customers.filter((customer) => normalizeNameForMatching(customer.name) === normalizedSpokenName);
  const ranked = rankCustomerCandidates(spokenName, customers);

  if (exactMatches.length === 1) {
    const match = exactMatches[0];
    return {
      customer: toMatchedCustomer(match, spokenName, 1),
      customerMatch: {
        state: "exact_unique_match",
        spokenName,
        helperText: "Matched confidently",
        confidence: 1,
        suggestedMatches: [toCustomerCandidate(match, 1, "Same customer name")],
        allMatches: [toCustomerCandidate(match, 1, "Same customer name")],
      },
    };
  }

  if (exactMatches.length > 1) {
    const exactRanked = rankCustomerCandidates(spokenName, exactMatches).map((entry) =>
      toCustomerCandidate(entry.customer, entry.score, entry.matchReason),
    );
    return {
      customer: null,
      customerMatch: {
        state: "duplicate_name_match",
        spokenName,
        helperText: `Please choose the correct customer`,
        confidence: exactRanked[0]?.confidence ?? null,
        suggestedMatches: exactRanked.slice(0, 3),
        allMatches: exactRanked,
      },
    };
  }

  const strongSuggestions = ranked
    .filter((entry) => entry.score >= 0.58)
    .slice(0, 5)
    .map((entry) => toCustomerCandidate(entry.customer, entry.score, entry.matchReason));

  if (strongSuggestions.length > 0) {
    return {
      customer: null,
      customerMatch: {
        state: "suggested_match_only",
        spokenName,
        helperText: "No exact customer selected",
        confidence: strongSuggestions[0]?.confidence ?? null,
        suggestedMatches: strongSuggestions,
        allMatches: strongSuggestions,
      },
    };
  }

  return {
    customer: null,
    customerMatch: {
      state: "no_match",
      spokenName,
      helperText: "No exact customer selected",
      confidence: ranked[0]?.score ?? null,
      suggestedMatches: [],
      allMatches: [],
    },
  };
};

const splitNormalizedTokens = (value: string): string[] =>
  normalizeVoiceText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

const findCustomerRegionMatch = (
  tokens: string[],
  customers: CatalogSnapshot["customers"],
  mode: "prefix" | "suffix",
): { customerPhrase: string; consumed: number; confidence: number } | null => {
  const maxTokens = Math.min(5, tokens.length);
  let best: { customerPhrase: string; consumed: number; confidence: number } | null = null;

  for (let count = 1; count <= maxTokens; count += 1) {
    const regionTokens =
      mode === "prefix" ? tokens.slice(0, count) : tokens.slice(tokens.length - count);
    const regionPhrase = regionTokens.join(" ");
    const exactMatches = customers.filter(
      (customer) => normalizeNameForMatching(customer.name) === normalizeNameForMatching(regionPhrase),
    );
    const ranked = rankCustomerCandidates(regionPhrase, customers);
    const topScore = ranked[0]?.score ?? 0;
    if (exactMatches.length === 0 && topScore < 0.64) {
      continue;
    }

    if (!best || topScore > best.confidence || count > best.consumed) {
      best = {
        customerPhrase: regionPhrase,
        consumed: count,
        confidence: topScore || 1,
      };
    }
  }

  return best;
};

const extractCustomerContext = (
  transcript: string,
  customers: CatalogSnapshot["customers"],
): { customerPhrase: string; itemTranscript: string } => {
  const tokens = splitNormalizedTokens(transcript);
  if (tokens.length === 0 || customers.length === 0) {
    const fallbackCustomer = extractCustomerHint(transcript);
    const fallbackItems = stripCustomerTail(transcript) || normalizeVoiceText(transcript);
    return {
      customerPhrase: fallbackCustomer,
      itemTranscript: fallbackItems,
    };
  }

  let best:
    | {
        customerPhrase: string;
        itemTranscript: string;
        confidence: number;
      }
    | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (CUSTOMER_PREFIX_MARKERS.has(token)) {
      const tail = tokens.slice(index + 1);
      const match = findCustomerRegionMatch(tail, customers, "prefix");
      if (!match) {
        continue;
      }

      const itemTokens = [...tokens.slice(0, index), ...tail.slice(match.consumed)];
      const candidate = {
        customerPhrase: match.customerPhrase,
        itemTranscript: itemTokens.join(" ").trim(),
        confidence: match.confidence,
      };
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
      continue;
    }

    if (CUSTOMER_SUFFIX_MARKERS.has(token)) {
      const tail = tokens.slice(index + 1);
      const match = findCustomerRegionMatch(tail, customers, "prefix");
      if (!match) {
        continue;
      }

      const itemTokens = [...tokens.slice(0, index), ...tail.slice(match.consumed)];
      const candidate = {
        customerPhrase: match.customerPhrase,
        itemTranscript: itemTokens.join(" ").trim(),
        confidence: match.confidence,
      };
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
      continue;
    }

    if (token === MYANMAR_FOR_MARKER) {
      const head = tokens.slice(0, index);
      const match = findCustomerRegionMatch(head, customers, "suffix");
      if (!match) {
        continue;
      }

      const itemTokens = [...head.slice(0, Math.max(0, head.length - match.consumed)), ...tokens.slice(index + 1)];
      const candidate = {
        customerPhrase: match.customerPhrase,
        itemTranscript: itemTokens.join(" ").trim(),
        confidence: match.confidence,
      };
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
    }
  }

  if (best) {
    return best;
  }

  const fallbackCustomer = extractCustomerHint(transcript);
  const fallbackItems = stripCustomerTail(transcript) || normalizeVoiceText(transcript);
  return {
    customerPhrase: fallbackCustomer,
    itemTranscript: fallbackItems,
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

const buildProductSuggestions = (
  phrase: string,
  products: CatalogSnapshot["products"],
): string[] => {
  const match = findBestEntityMatchByName(phrase, products);
  if (match.match && !match.ambiguous) {
    return [];
  }
  return uniqueNames(match.suggestions).slice(0, 3);
};

const extractCatalogItemPhrases = (
  transcript: string,
  products: CatalogSnapshot["products"],
): Array<{ phrase: string; quantity: number }> => {
  const tokens = splitNormalizedTokens(transcript);
  if (tokens.length === 0 || products.length === 0) {
    return [];
  }

  const phrases: Array<{ phrase: string; quantity: number }> = [];
  let index = 0;

  while (index < tokens.length) {
    let best:
      | {
          phrase: string;
          consumed: number;
          confidence: number;
        }
      | null = null;

    const maxTokens = Math.min(5, tokens.length - index);
    for (let count = maxTokens; count >= 1; count -= 1) {
      const region = tokens.slice(index, index + count).join(" ");
      const match = findBestEntityMatchByName(region, products);
      if (!match.match || match.ambiguous || match.confidence < 0.72) {
        continue;
      }

      best = {
        phrase: match.match.name,
        consumed: count,
        confidence: match.confidence,
      };
      break;
    }

    if (!best) {
      index += 1;
      continue;
    }

    phrases.push({
      phrase: best.phrase,
      quantity: 1,
    });
    index += best.consumed;
  }

  const deduped = new Map<string, { phrase: string; quantity: number }>();
  for (const row of phrases) {
    const key = normalizeVoiceText(row.phrase);
    const existing = deduped.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      continue;
    }
    deduped.set(key, { ...row });
  }

  return Array.from(deduped.values());
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
  const { customer, customerMatch } = params.customerPhrase
    ? buildCustomerMatchInfo(params.customerPhrase, params.catalog.customers)
    : {
        customer: null,
        customerMatch: {
          state: "no_match" as const,
          spokenName: null,
          helperText: "No customer selected",
          confidence: null,
          suggestedMatches: [],
          allMatches: [],
        },
      };

  const items = params.itemPhrases.map((entry) => {
    const product = buildMatchedProduct(entry.phrase, params.catalog.products);
    return toDraftItem(entry.phrase, entry.quantity, product);
  });

  const unmatchedPhrases = items
    .filter((item) => !item.product)
    .map((item) => item.rawText);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const warnings = items.flatMap((item) => item.warnings);
  const productSuggestions = uniqueNames(
    unmatchedPhrases.flatMap((phrase) => buildProductSuggestions(phrase, params.catalog.products)),
  ).slice(0, 5);

  if (customerMatch.state === "duplicate_name_match" && customerMatch.spokenName) {
    warnings.push(`Multiple customers found for "${customerMatch.spokenName}".`);
  } else if (customerMatch.state === "suggested_match_only" && customerMatch.suggestedMatches.length > 0) {
    warnings.push("Customer could not be matched confidently.");
    warnings.push(
      `Suggested customers: ${customerMatch.suggestedMatches.map((candidate) => candidate.name).join(", ")}`,
    );
  } else if (customerMatch.state === "no_match" && params.customerPhrase) {
    warnings.push("Customer could not be matched confidently.");
  }
  if (items.length === 0) {
    warnings.push("No item phrases were found in the transcript.");
  }
  if (unmatchedPhrases.length > 0) {
    warnings.push("Some item phrases need manual confirmation.");
  }
  if (unmatchedPhrases.length > 0 && productSuggestions.length > 0) {
    warnings.push(`Suggested products: ${productSuggestions.join(", ")}`);
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
    customerMatch,
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
    const customerContext = extractCustomerContext(transcript, catalog.customers);
    const itemTranscript = customerContext.itemTranscript || transcript;
    const customerPhrase = customerContext.customerPhrase;
    const extractedLines = extractVoiceLineCandidates(itemTranscript);
    const catalogItemPhrases = extractedLines.length === 0
      ? extractCatalogItemPhrases(itemTranscript, catalog.products)
      : [];
    const itemPhrases =
      extractedLines.length > 0
        ? extractedLines
            .map((line) => ({
              phrase: String(line.name ?? "").trim(),
              quantity: line.quantity ?? parseSpokenQuantity(line.quantityRaw) ?? 1,
            }))
            .filter((line) => line.phrase)
        : catalogItemPhrases.length > 0
          ? catalogItemPhrases
          : splitItemSegments(itemTranscript).map((segment) => {
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
