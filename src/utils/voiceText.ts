const MYANMAR_DIGIT_TO_ASCII: Record<string, string> = {
  "၀": "0",
  "၁": "1",
  "၂": "2",
  "၃": "3",
  "၄": "4",
  "၅": "5",
  "၆": "6",
  "၇": "7",
  "၈": "8",
  "၉": "9",
};

const MYANMAR_CLASSIFIER_PATTERN =
  /(ခု|လုံး|ထည်|စုံ|ပုလင်း|ဘူး|ပွဲ|ခွက်|ကီလို|kg|g|gram|grams|pcs?|pieces?|unit|units?)$/iu;

const ENGLISH_SMALL_NUMBER: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const ENGLISH_TENS_NUMBER: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const MYANMAR_UNIT_FORMS: Array<{ forms: string[]; value: number }> = [
  { forms: ["တစ်", "တစ", "တစ္", "တခု", "တစ်ခု", "၁", "1"], value: 1 },
  { forms: ["နှစ်", "ႏွစ္", "၂", "2"], value: 2 },
  { forms: ["သုံး", "သံုး", "၃", "3"], value: 3 },
  { forms: ["လေး", "ေလး", "၄", "4"], value: 4 },
  { forms: ["ငါး", "၅", "5"], value: 5 },
  { forms: ["ခြောက်", "ေျခာက္", "၆", "6"], value: 6 },
  { forms: ["ခုနစ်", "ခုႏွစ္", "၇", "7"], value: 7 },
  { forms: ["ရှစ်", "ရွစ္", "၈", "8"], value: 8 },
  { forms: ["ကိုး", "၉", "9"], value: 9 },
  { forms: ["သုည", "သုန္ည", "၀", "0"], value: 0 },
];

const COMMAND_PREFIX_PATTERN =
  /^(please\s+|pls\s+|add\s+|new\s+|create\s+|sale\s+|order\s+|invoice\s+|ထည့်\s*|ထည့္\s*|ထည့္\s*|ထည့်ပါ\s*|ထည့္ပါ\s*|အော်ဒါ\s*|အင်ဗွိုက်စ်\s*|ဘောင်ချာ\s*)+/iu;

const CUSTOMER_PATTERNS: RegExp[] = [
  /\b(?:for|to|customer)\s+([^,.;\n]+)/iu,
  /(?:ဖောက်သည်|ဖေါက်သည်)\s*([^,.;\n]+)/u,
  /([^,.;\n]+?)\s*အတွက်/u,
];

export type VoiceLineCandidate = {
  name: string;
  quantity: number | null;
  quantityRaw: string;
};

const normalizeMyanmarDigits = (value: string): string =>
  value.replace(/[၀-၉]/g, (char) => MYANMAR_DIGIT_TO_ASCII[char] ?? char);

export const normalizeVoiceText = (value: string): string =>
  normalizeMyanmarDigits(String(value ?? ""))
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[\u1037\u1038]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeNameForMatching = (value: string): string =>
  normalizeVoiceText(value)
    .replace(/\b(item|items|customer|sale|order|invoice|line|qty|quantity|add|take|ထည့်|ထည့္|ခု)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeMyanmarNumberText = (value: string): string =>
  normalizeMyanmarDigits(String(value ?? "").trim())
    .replace(MYANMAR_CLASSIFIER_PATTERN, "")
    .replace(/\s+/g, "");

const parseMyanmarUnit = (value: string): number | null => {
  const token = normalizeMyanmarNumberText(value);
  if (!token) return null;
  for (const entry of MYANMAR_UNIT_FORMS) {
    if (entry.forms.some((form) => normalizeMyanmarNumberText(form) === token)) {
      return entry.value;
    }
  }
  return null;
};

const parseMyanmarWordNumber = (value: string): number | null => {
  const token = normalizeMyanmarNumberText(value);
  if (!token) return null;
  if (/^\d+(?:\.\d+)?$/.test(token)) {
    const numeric = Number(token);
    if (Number.isFinite(numeric)) return numeric;
    return null;
  }

  const direct = parseMyanmarUnit(token);
  if (direct !== null) return direct;

  const splitWithMultiplier = (marker: string, multiplier: number): number | null => {
    const index = token.indexOf(marker);
    if (index < 0) return null;

    const left = token.slice(0, index);
    const right = token.slice(index + marker.length);
    const leftValue = left ? parseMyanmarWordNumber(left) : 1;
    if (leftValue === null) return null;

    if (!right) {
      return leftValue * multiplier;
    }

    const rightValue = parseMyanmarWordNumber(right);
    if (rightValue === null) return null;
    return leftValue * multiplier + rightValue;
  };

  const thousand = splitWithMultiplier("ထောင်", 1000);
  if (thousand !== null) return thousand;

  const hundred = splitWithMultiplier("ရာ", 100);
  if (hundred !== null) return hundred;

  const ten = splitWithMultiplier("ဆယ်", 10);
  if (ten !== null) return ten;

  return null;
};

const parseEnglishWordNumber = (value: string): number | null => {
  const tokens = normalizeVoiceText(value)
    .replace(/-/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  let total = 0;
  let current = 0;
  let used = false;

  for (const token of tokens) {
    if (token in ENGLISH_SMALL_NUMBER) {
      current += ENGLISH_SMALL_NUMBER[token];
      used = true;
      continue;
    }
    if (token in ENGLISH_TENS_NUMBER) {
      current += ENGLISH_TENS_NUMBER[token];
      used = true;
      continue;
    }
    if (token === "hundred") {
      current = (current || 1) * 100;
      used = true;
      continue;
    }
    if (token === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      used = true;
      continue;
    }
    if (token === "and" || token === "a" || token === "an") {
      continue;
    }
    return null;
  }

  if (!used) return null;
  return total + current;
};

export const parseSpokenQuantity = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  const raw = normalizeMyanmarDigits(value.trim());
  if (!raw) return null;

  const strippedClassifier = raw.replace(MYANMAR_CLASSIFIER_PATTERN, "").trim();
  if (/^\d+(?:\.\d+)?$/.test(strippedClassifier)) {
    const parsed = Number(strippedClassifier);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const embeddedNumber = strippedClassifier.match(/\d+(?:\.\d+)?/);
  if (embeddedNumber) {
    const parsed = Number(embeddedNumber[0]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const englishWord = parseEnglishWordNumber(strippedClassifier);
  if (englishWord !== null && englishWord > 0) {
    return englishWord;
  }

  const myanmarWord = parseMyanmarWordNumber(strippedClassifier);
  if (myanmarWord !== null && myanmarWord > 0) {
    return myanmarWord;
  }

  return null;
};

const cleanupCandidateName = (value: string): string =>
  normalizeNameForMatching(
    String(value ?? "")
      .replace(COMMAND_PREFIX_PATTERN, "")
      .replace(/\b(for|to|customer|sale|order|invoice|draft|add)\b/giu, " ")
      .replace(/(ဖောက်သည်|ဖေါက်သည်|အတွက်|အော်ဒါ|အင်ဗွိုက်စ်|ဘောင်ချာ)/gu, " ")
      .replace(MYANMAR_CLASSIFIER_PATTERN, "")
      .replace(/\s+/g, " ")
      .trim(),
  );

const extractQuantityFromTokens = (
  tokens: string[],
  fromStart: boolean,
): { qty: number; raw: string; rest: string } | null => {
  const maxTokens = Math.min(3, tokens.length);

  for (let count = maxTokens; count >= 1; count -= 1) {
    const probe = fromStart ? tokens.slice(0, count) : tokens.slice(tokens.length - count);
    const quantityRaw = probe.join(" ");
    const qty = parseSpokenQuantity(quantityRaw);
    if (qty === null || qty <= 0) continue;

    const restTokens = fromStart ? tokens.slice(count) : tokens.slice(0, tokens.length - count);
    const rest = cleanupCandidateName(restTokens.join(" "));
    if (!rest) continue;

    return { qty, raw: quantityRaw, rest };
  }

  return null;
};

const extractCandidateFromSegment = (segment: string): VoiceLineCandidate | null => {
  const trimmed = String(segment ?? "").trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.replace(COMMAND_PREFIX_PATTERN, "").trim();
  const tokens = withoutPrefix
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < 2) return null;

  const qtyFirst = extractQuantityFromTokens(tokens, true);
  if (qtyFirst) {
    return {
      name: qtyFirst.rest,
      quantity: qtyFirst.qty,
      quantityRaw: qtyFirst.raw,
    };
  }

  const qtyLast = extractQuantityFromTokens(tokens, false);
  if (qtyLast) {
    return {
      name: qtyLast.rest,
      quantity: qtyLast.qty,
      quantityRaw: qtyLast.raw,
    };
  }

  return null;
};

export const extractVoiceLineCandidates = (transcript: string): VoiceLineCandidate[] => {
  const text = String(transcript ?? "").trim();
  if (!text) return [];

  const normalized = text
    .replace(/\band\b/giu, ",")
    .replace(/[၊;|\n]+/gu, ",")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",");

  const segments = normalized
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  const lines: VoiceLineCandidate[] = [];
  for (const segment of segments) {
    const candidate = extractCandidateFromSegment(segment);
    if (!candidate) continue;
    lines.push(candidate);
  }

  const deduped = new Map<string, VoiceLineCandidate>();
  for (const row of lines) {
    const key = normalizeNameForMatching(row.name);
    if (!key) continue;

    const existing = deduped.get(key);
    if (existing) {
      deduped.set(key, {
        ...existing,
        quantity: (existing.quantity ?? 0) + (row.quantity ?? 0),
        quantityRaw: `${existing.quantityRaw} + ${row.quantityRaw}`,
      });
      continue;
    }

    deduped.set(key, row);
  }

  return Array.from(deduped.values());
};

export const extractCustomerHint = (transcript: string): string => {
  const text = String(transcript ?? "").trim();
  if (!text) return "";

  for (const pattern of CUSTOMER_PATTERNS) {
    const match = text.match(pattern);
    const raw = String(match?.[1] ?? "").trim();
    if (!raw) continue;

    const cleaned = raw
      .replace(/\b(invoice|sale|order|draft|add|items?)\b/giu, " ")
      .replace(/(အော်ဒါ|အင်ဗွိုက်စ်|ဘောင်ချာ|ထည့်|ထည့္)/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) return cleaned;
  }

  return "";
};

export const stripCustomerTail = (transcript: string): string =>
  normalizeVoiceText(transcript)
    .replace(/(?:customer|for|to)\s+.+$/i, "")
    .replace(/\s+.+\s+အတွက်$/i, "")
    .trim();

export const splitItemSegments = (transcript: string): string[] => {
  const candidates = extractVoiceLineCandidates(transcript);
  if (candidates.length > 0) {
    return candidates.map((candidate) => `${candidate.quantityRaw} ${candidate.name}`.trim());
  }

  const itemRegion = stripCustomerTail(transcript) || normalizeVoiceText(transcript);
  const segments = itemRegion
    .split(/\s*(?:,|၊|\band\b|\bplus\b|နဲ့|နဲ႔|နှင့်)\s*/giu)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length ? segments : [itemRegion];
};

export const removeQuantityWords = (segment: string): string => {
  const normalized = normalizeVoiceText(segment);
  return normalized
    .replace(/^(add|take|qty|quantity)\s+/i, "")
    .replace(/^\d+(?:\.\d+)?\s+/i, "")
    .replace(/\b(?:qty|quantity|x|pcs?|piece|pieces|ခု|ဘူး|ပုလင်း|လုံး)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
};
