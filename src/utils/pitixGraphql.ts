import { config } from "../config/index.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

export type GraphQlErrorItem = {
  message?: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
};

type TimeoutPhase = "before_response" | "during_body_parse";

type GraphQlPayload<TData> = {
  data?: TData;
  errors?: GraphQlErrorItem[];
};

type PitixGraphqlRequestParams = {
  endpoint: string;
  query: string;
  variables?: Record<string, unknown>;
  headers?: HeadersInit;
  requestId?: string;
  operationName?: string;
  timeoutMs?: number;
};

const normalizeToken = (value: string): string =>
  String(value ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

export const maskToken = (value: string | null | undefined): string => {
  const token = normalizeToken(String(value ?? ""));
  if (!token) {
    return "";
  }
  if (token.length <= 10) {
    return `${token.slice(0, 2)}***${token.slice(-2)}`;
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
};

export const extractGraphqlOperationName = (query: string): string => {
  const match = query.match(/^\s*(query|mutation)\s+([A-Za-z0-9_]+)/m);
  return match?.[2] ?? "AnonymousOperation";
};

const toRecord = (value: HeadersInit | undefined): Record<string, string> => {
  if (!value) {
    return {};
  }
  if (value instanceof Headers) {
    return Object.fromEntries(value.entries());
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, headerValue]) => [key, String(headerValue)]));
};

const sanitizeHeadersForLogs = (headers: HeadersInit | undefined): Record<string, string> => {
  const entries = toRecord(headers);
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(entries)) {
    const normalizedKey = key.toLowerCase();
    sanitized[key] = normalizedKey === "authorization" ? maskToken(value) : value;
  }

  return sanitized;
};

const getBodyPreview = (body: string): string =>
  body.length > 400 ? `${body.slice(0, 400)}...` : body;

export const pitixGraphqlRequest = async <TData>(
  params: PitixGraphqlRequestParams,
): Promise<TData> => {
  const operationName = params.operationName ?? extractGraphqlOperationName(params.query);
  const timeoutMs = params.timeoutMs ?? config.pitixRequestTimeoutMs;
  const controller = new AbortController();
  let timeoutPhase: TimeoutPhase = "before_response";
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const elapsedMs = () => Date.now() - startedAtMs;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  logger.info("PitiX GraphQL request started", {
    requestId: params.requestId,
    endpoint: params.endpoint,
    operationName,
    startedAt,
    timeoutMs,
    headers: sanitizeHeadersForLogs(params.headers),
    variableKeys: Object.keys(params.variables ?? {}),
  });

  let response: Response | null = null;
  let responseText = "";
  try {
    response = await fetch(params.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.headers ?? {}),
      },
      body: JSON.stringify({
        query: params.query,
        variables: params.variables ?? {},
      }),
      signal: controller.signal,
    });

    timeoutPhase = "during_body_parse";

    logger.info("PitiX GraphQL response headers received", {
      requestId: params.requestId,
      endpoint: params.endpoint,
      operationName,
      startedAt,
      elapsedMs: elapsedMs(),
      responseStatus: response.status,
    });

    responseText = await response.text();
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === "AbortError") {
      logger.warn("PitiX GraphQL request timed out", {
        requestId: params.requestId,
        endpoint: params.endpoint,
        operationName,
        startedAt,
        elapsedMs: elapsedMs(),
        responseStatus: response?.status ?? null,
        timeoutMs,
        timeoutPhase,
      });

      throw new AppError(`PitiX GraphQL request timed out after ${timeoutMs}ms.`, {
        statusCode: 504,
        code: "pitix_backend_timeout",
        details: {
          endpoint: params.endpoint,
          operationName,
          timeoutMs,
          elapsedMs: elapsedMs(),
          responseStatus: response?.status ?? null,
          timeoutPhase,
        },
      });
    }

    logger.error("PitiX GraphQL request failed before completion", {
      requestId: params.requestId,
      endpoint: params.endpoint,
      operationName,
      startedAt,
      elapsedMs: elapsedMs(),
      responseStatus: response?.status ?? null,
      timeoutPhase,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new AppError("Failed to reach the PitiX GraphQL endpoint.", {
      statusCode: 502,
      code: "pitix_backend_network_error",
      details: {
        endpoint: params.endpoint,
        operationName,
        message: error instanceof Error ? error.message : String(error),
        elapsedMs: elapsedMs(),
        responseStatus: response?.status ?? null,
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response) {
    throw new AppError("PitiX GraphQL returned no response object.", {
      statusCode: 502,
      code: "pitix_missing_response",
      details: {
        endpoint: params.endpoint,
        operationName,
        elapsedMs: elapsedMs(),
      },
    });
  }

  let payload: GraphQlPayload<TData> | null = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as GraphQlPayload<TData>;
    } catch (_error) {
      logger.warn("PitiX GraphQL returned invalid JSON", {
        requestId: params.requestId,
        endpoint: params.endpoint,
        operationName,
        startedAt,
        elapsedMs: elapsedMs(),
        responseStatus: response?.status ?? null,
        bodyPreview: getBodyPreview(responseText),
      });

      throw new AppError("PitiX GraphQL returned invalid JSON.", {
        statusCode: 502,
        code: "pitix_invalid_json",
        details: {
          endpoint: params.endpoint,
          operationName,
          httpStatus: response?.status ?? null,
          elapsedMs: elapsedMs(),
          bodyPreview: getBodyPreview(responseText),
        },
      });
    }
  }

  if (!response.ok) {
    logger.warn("PitiX GraphQL returned HTTP error", {
      requestId: params.requestId,
      endpoint: params.endpoint,
      operationName,
      startedAt,
      elapsedMs: elapsedMs(),
      responseStatus: response?.status ?? null,
      graphqlErrorCount: payload?.errors?.length ?? 0,
    });

    throw new AppError(`PitiX GraphQL HTTP error (${response.status}).`, {
      statusCode: 502,
      code: "pitix_backend_http_error",
      details: {
        endpoint: params.endpoint,
        operationName,
        httpStatus: response.status,
        elapsedMs: elapsedMs(),
        errors: payload?.errors ?? [],
        bodyPreview: payload ? undefined : getBodyPreview(responseText),
      },
    });
  }

  if (payload?.errors?.length) {
    logger.warn("PitiX GraphQL returned GraphQL errors", {
      requestId: params.requestId,
      endpoint: params.endpoint,
      operationName,
      startedAt,
      elapsedMs: elapsedMs(),
      responseStatus: response.status,
      graphqlErrorCount: payload.errors.length,
    });

    throw new AppError(
      payload.errors.map((item) => item.message).filter(Boolean).join("; ") || "PitiX GraphQL returned errors.",
      {
        statusCode: 502,
        code: "pitix_graphql_error",
        details: {
          endpoint: params.endpoint,
          operationName,
          elapsedMs: elapsedMs(),
          httpStatus: response.status,
          errors: payload.errors,
        },
      },
    );
  }

  if (!payload?.data) {
    logger.warn("PitiX GraphQL returned empty data", {
      requestId: params.requestId,
      endpoint: params.endpoint,
      operationName,
      startedAt,
      elapsedMs: elapsedMs(),
      responseStatus: response.status,
    });

    throw new AppError("PitiX GraphQL returned an empty data payload.", {
      statusCode: 502,
      code: "pitix_empty_response",
      details: {
        endpoint: params.endpoint,
        operationName,
        elapsedMs: elapsedMs(),
        httpStatus: response.status,
      },
    });
  }

  logger.info("PitiX GraphQL request completed", {
    requestId: params.requestId,
    endpoint: params.endpoint,
    operationName,
    startedAt,
    elapsedMs: elapsedMs(),
    responseStatus: response.status,
    dataKeys: Object.keys(payload.data as Record<string, unknown>),
  });

  return payload.data;
};
