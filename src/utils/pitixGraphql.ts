import { config } from "../config/index.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

export type GraphQlErrorItem = {
  message?: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
};

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
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (config.pitixDebugLogs) {
    logger.info("PitiX GraphQL request", {
      requestId: params.requestId,
      endpoint: params.endpoint,
      operationName,
      timeoutMs,
      headers: sanitizeHeadersForLogs(params.headers),
      variableKeys: Object.keys(params.variables ?? {}),
    });
  }

  let response: Response;
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
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(`PitiX GraphQL request timed out after ${timeoutMs}ms.`, {
        statusCode: 504,
        code: "pitix_backend_timeout",
        details: {
          endpoint: params.endpoint,
          operationName,
          timeoutMs,
        },
      });
    }

    throw new AppError("Failed to reach the PitiX GraphQL endpoint.", {
      statusCode: 502,
      code: "pitix_backend_network_error",
      details: {
        endpoint: params.endpoint,
        operationName,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  clearTimeout(timeout);

  const responseText = await response.text();
  let payload: GraphQlPayload<TData> | null = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as GraphQlPayload<TData>;
    } catch (_error) {
      throw new AppError("PitiX GraphQL returned invalid JSON.", {
        statusCode: 502,
        code: "pitix_invalid_json",
        details: {
          endpoint: params.endpoint,
          operationName,
          httpStatus: response.status,
          bodyPreview: getBodyPreview(responseText),
        },
      });
    }
  }

  if (!response.ok) {
    throw new AppError(`PitiX GraphQL HTTP error (${response.status}).`, {
      statusCode: 502,
      code: "pitix_backend_http_error",
      details: {
        endpoint: params.endpoint,
        operationName,
        httpStatus: response.status,
        errors: payload?.errors ?? [],
        bodyPreview: payload ? undefined : getBodyPreview(responseText),
      },
    });
  }

  if (payload?.errors?.length) {
    throw new AppError(
      payload.errors.map((item) => item.message).filter(Boolean).join("; ") || "PitiX GraphQL returned errors.",
      {
        statusCode: 502,
        code: "pitix_graphql_error",
        details: {
          endpoint: params.endpoint,
          operationName,
          errors: payload.errors,
        },
      },
    );
  }

  if (!payload?.data) {
    throw new AppError("PitiX GraphQL returned an empty data payload.", {
      statusCode: 502,
      code: "pitix_empty_response",
      details: {
        endpoint: params.endpoint,
        operationName,
      },
    });
  }

  if (config.pitixDebugLogs) {
    logger.info("PitiX GraphQL response", {
      requestId: params.requestId,
      endpoint: params.endpoint,
      operationName,
      dataKeys: Object.keys(payload.data as Record<string, unknown>),
    });
  }

  return payload.data;
};
