export const extractJsonObject = (raw: string): string => {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, index + 1);
      }
    }
  }

  return "";
};

export const parseJsonObject = <T>(raw: string): T | null => {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
};

