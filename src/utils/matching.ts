import { normalizeVoiceText } from "./voiceText.js";

const englishPhoneticKey = (value: string): string => {
  const letters = normalizeVoiceText(value).replace(/[^a-z]/g, "");
  if (!letters) return "";

  const lead = letters[0];
  const tail = letters
    .slice(1)
    .replace(/ph/g, "f")
    .replace(/[aeiouy]/g, "")
    .replace(/[ckq]/g, "k")
    .replace(/[sz]/g, "s")
    .replace(/[fv]/g, "f")
    .replace(/[dt]/g, "t")
    .replace(/[bp]/g, "p")
    .replace(/(.)\1+/g, "$1");

  return `${lead}${tail}`;
};

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = new Array(b.length + 1).fill(0).map((_, index) => index);
  const current = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
};

const tokenOverlapRatio = (a: string, b: string): number => {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }

  return overlap / Math.max(tokensA.size, tokensB.size);
};

const buildSimilarityScore = (target: string, candidate: string): number => {
  if (!target || !candidate) return 0;
  if (target === candidate) return 1;

  const targetNoSpace = target.replace(/\s+/g, "");
  const candidateNoSpace = candidate.replace(/\s+/g, "");

  const containsScore =
    candidate.includes(target) || target.includes(candidate)
      ? 0.84 - Math.min(Math.abs(candidate.length - target.length) / 100, 0.18)
      : 0;

  const tokenScore = tokenOverlapRatio(target, candidate) * 0.82;

  const maxLen = Math.max(targetNoSpace.length, candidateNoSpace.length, 1);
  const editScore = (1 - levenshtein(targetNoSpace, candidateNoSpace) / maxLen) * 0.78;

  const phoneticScore =
    englishPhoneticKey(target) && englishPhoneticKey(target) === englishPhoneticKey(candidate)
      ? 0.75
      : 0;

  return Math.max(containsScore, tokenScore, editScore, phoneticScore);
};

const normalizeNameForMatching = (value: string): string =>
  normalizeVoiceText(value)
    .replace(/\b(item|items|customer|sale|order|line|qty|quantity|add|take|pcs?|piece|pieces|ခု)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

export type EntityMatchResult<T> = {
  match: T | null;
  confidence: number;
  suggestions: string[];
  ambiguous: boolean;
};

export const findBestEntityMatchByName = <T extends { name: string }>(
  rawTarget: string,
  entities: T[],
): EntityMatchResult<T> => {
  const target = normalizeNameForMatching(rawTarget);
  if (!target || entities.length === 0) {
    return { match: null, confidence: 0, suggestions: [], ambiguous: false };
  }

  const scored = entities
    .map((entity) => {
      const candidate = normalizeNameForMatching(entity.name);
      return {
        entity,
        score: buildSimilarityScore(target, candidate),
      };
    })
    .sort((left, right) => right.score - left.score);

  const top = scored[0];
  const second = scored[1];
  const suggestions = scored
    .slice(0, 5)
    .map((entry) => entry.entity.name)
    .filter(Boolean);

  if (!top || top.score < 0.48) {
    return { match: null, confidence: top?.score ?? 0, suggestions, ambiguous: false };
  }

  const ambiguous = Boolean(second && second.score >= 0.63 && top.score - second.score < 0.08);

  if (ambiguous) {
    return {
      match: null,
      confidence: top.score,
      suggestions,
      ambiguous: true,
    };
  }

  return {
    match: top.entity,
    confidence: top.score,
    suggestions,
    ambiguous: false,
  };
};
