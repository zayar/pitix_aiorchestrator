import { normalizeVoiceText } from "./voiceText.js";

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
  const target = normalizeVoiceText(rawTarget);
  if (!target) {
    return { match: null, confidence: 0, suggestions: [], ambiguous: false };
  }

  const scored = entities
    .map((entity) => {
      const candidate = normalizeVoiceText(entity.name);
      if (!candidate) return { entity, score: 0 };

      if (candidate === target) {
        return { entity, score: 1 };
      }
      if (candidate.includes(target) || target.includes(candidate)) {
        return { entity, score: 0.9 };
      }

      const distance = levenshtein(target, candidate);
      const score = Math.max(0, 1 - distance / Math.max(target.length, candidate.length, 1));
      return { entity, score };
    })
    .sort((left, right) => right.score - left.score);

  const top = scored[0];
  const second = scored[1];
  const suggestions = scored.slice(0, 5).map((entry) => entry.entity.name);

  if (!top || top.score < 0.58) {
    return { match: null, confidence: top?.score ?? 0, suggestions, ambiguous: false };
  }

  return {
    match: top.entity,
    confidence: top.score,
    suggestions,
    ambiguous: Boolean(second && Math.abs(top.score - second.score) < 0.04),
  };
};

