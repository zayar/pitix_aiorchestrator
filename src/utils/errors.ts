export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options?: { statusCode?: number; code?: string; details?: unknown }) {
    super(message);
    this.statusCode = options?.statusCode ?? 500;
    this.code = options?.code ?? "internal_error";
    this.details = options?.details;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;

