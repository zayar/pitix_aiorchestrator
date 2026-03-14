import "dotenv/config";

const getRequiredEnv = (key: string, fallback = ""): string => {
  const value = String(process.env[key] ?? fallback).trim();
  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 8080),
  requestBodyLimit: String(process.env.REQUEST_BODY_LIMIT ?? "12mb").trim() || "12mb",
  logRequestBodies: process.env.LOG_REQUEST_BODIES === "true",
  sttProvider: String(process.env.STT_PROVIDER ?? "stub").trim() || "stub",
  llmProvider: String(process.env.LLM_PROVIDER ?? "heuristic").trim() || "heuristic",
  gcpProjectId: String(process.env.GCP_PROJECT_ID ?? "").trim(),
  vertexRegion: String(process.env.VERTEX_REGION ?? "asia-southeast1").trim() || "asia-southeast1",
  vertexModel: String(process.env.VERTEX_MODEL ?? "gemini-2.5-flash").trim() || "gemini-2.5-flash",
  vertexSttModel: String(process.env.VERTEX_STT_MODEL ?? process.env.VERTEX_MODEL ?? "gemini-2.5-flash").trim() || "gemini-2.5-flash",
  pitixAccountGraphqlUrl: getRequiredEnv("PITIX_ACCOUNT_GRAPHQL_URL", "https://api-ext.pitix.app/account"),
  pitixPosGraphqlUrl: getRequiredEnv("PITIX_POS_GRAPHQL_URL", "https://api-ext.pitix.app/pos"),
  pitixDefaultSaleStatus:
    String(process.env.PITIX_DEFAULT_SALE_STATUS ?? "PENDING").trim().toUpperCase() === "COMPLETED"
      ? "COMPLETED"
      : "PENDING",
};

