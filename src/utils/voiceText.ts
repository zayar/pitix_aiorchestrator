const MYANMAR_DIGIT_MAP: Record<string, string> = {
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

const ENGLISH_NUMBERS: Record<string, number> = {
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
};

const splitPattern = /\s*(?:,|၊|\band\b|\bplus\b|နဲ့|နဲ႔|နှင့်)\s*/giu;

export const normalizeVoiceText = (value: string): string =>
  String(value ?? "")
    .replace(/[၀-၉]/g, (char) => MYANMAR_DIGIT_MAP[char] ?? char)
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const parseSpokenQuantity = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const normalized = normalizeVoiceText(String(value ?? ""));
  if (!normalized) return null;

  const numberMatch = normalized.match(/\d+(?:\.\d+)?/);
  if (numberMatch) {
    const parsed = Number(numberMatch[0]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const word = ENGLISH_NUMBERS[normalized];
  return typeof word === "number" && word > 0 ? word : null;
};

export const extractCustomerHint = (transcript: string): string => {
  const normalized = normalizeVoiceText(transcript);
  const englishMatch = normalized.match(/(?:customer|for|to)\s+(.+)$/i);
  if (englishMatch?.[1]) {
    return englishMatch[1].trim();
  }

  const myanmarMatch = normalized.match(/(.+?)\s+အတွက်$/i);
  if (myanmarMatch?.[1]) {
    return myanmarMatch[1].trim();
  }

  return "";
};

export const stripCustomerTail = (transcript: string): string =>
  normalizeVoiceText(transcript)
    .replace(/(?:customer|for|to)\s+.+$/i, "")
    .replace(/\s+.+\s+အတွက်$/i, "")
    .trim();

export const splitItemSegments = (transcript: string): string[] => {
  const itemRegion = stripCustomerTail(transcript) || normalizeVoiceText(transcript);
  const segments = itemRegion.split(splitPattern).map((segment) => segment.trim()).filter(Boolean);
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

