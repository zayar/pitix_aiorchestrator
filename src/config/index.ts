import "dotenv/config";

const getStringEnv = (key: string, fallback = ""): string => {
  const value = String(process.env[key] ?? fallback).trim();
  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
};

const getBooleanEnv = (key: string, fallback: boolean): boolean => {
  const rawValue = String(process.env[key] ?? "").trim().toLowerCase();
  if (!rawValue) {
    return fallback;
  }
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  throw new Error(`Invalid env var: ${key}. Expected "true" or "false".`);
};

const getPositiveNumberEnv = (key: string, fallback: number): number => {
  const rawValue = String(process.env[key] ?? "").trim();
  if (!rawValue) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid env var: ${key}. Expected a positive number.`);
  }
  return value;
};

const getUrlEnv = (key: string, fallback: string): string => {
  const value = getStringEnv(key, fallback);
  try {
    new URL(value);
  } catch (_error) {
    throw new Error(`Invalid env var: ${key}. Expected a full URL.`);
  }
  return value;
};

export const config = {
  port: getPositiveNumberEnv("PORT", 8080),
  requestBodyLimit: getStringEnv("REQUEST_BODY_LIMIT", "12mb"),
  logRequestBodies: getBooleanEnv("LOG_REQUEST_BODIES", false),
  sttProvider: getStringEnv("STT_PROVIDER", "stub"),
  llmProvider: getStringEnv("LLM_PROVIDER", "heuristic"),
  gcpProjectId: String(process.env.GCP_PROJECT_ID ?? "").trim(),
  vertexRegion: getStringEnv("VERTEX_REGION", "asia-southeast1"),
  vertexModel: getStringEnv("VERTEX_MODEL", "gemini-2.5-flash"),
  vertexSttModel: getStringEnv("VERTEX_STT_MODEL", String(process.env.VERTEX_MODEL ?? "gemini-2.5-flash")),
  pitixAccountGraphqlUrl: getUrlEnv("PITIX_ACCOUNT_GRAPHQL_URL", "https://api-ext.pitix.app/account"),
  pitixPosGraphqlUrl: getUrlEnv("PITIX_POS_GRAPHQL_URL", "https://api-ext.pitix.app/pos"),
  pitixRequestTimeoutMs: getPositiveNumberEnv("PITIX_REQUEST_TIMEOUT_MS", 15000),
  pitixDebugLogs: getBooleanEnv("PITIX_DEBUG_LOGS", false),
  pitixDefaultSaleStatus:
    getStringEnv("PITIX_DEFAULT_SALE_STATUS", "PENDING").toUpperCase() === "COMPLETED"
      ? "COMPLETED"
      : "PENDING",
};
