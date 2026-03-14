export type LogFields = Record<string, unknown>;

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (nestedValue instanceof Error) {
        return {
          name: nestedValue.name,
          message: nestedValue.message,
          stack: nestedValue.stack,
        };
      }
      return nestedValue;
    });
  } catch (error) {
    return JSON.stringify({
      level: "ERROR",
      message: "Failed to serialize log payload",
      error: String(error),
    });
  }
};

const log = (level: "INFO" | "WARN" | "ERROR", message: string, fields?: LogFields) => {
  console.log(
    safeJson({
      level,
      message,
      time: new Date().toISOString(),
      ...fields,
    }),
  );
};

export const logger = {
  info(message: string, fields?: LogFields) {
    log("INFO", message, fields);
  },
  warn(message: string, fields?: LogFields) {
    log("WARN", message, fields);
  },
  error(message: string, fields?: LogFields) {
    log("ERROR", message, fields);
  },
};

