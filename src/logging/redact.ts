const SENSITIVE_KEY_PATTERN = /token|secret|password|apikey/i;
const SENSITIVE_HEADER_KEYS = new Set(["authorization", "cookie", "set-cookie"]);
const MAX_STRING_LENGTH = 2 * 1024;
const MAX_ENTRIES = 50;
const REDACTED_MARKER = "[REDACTED]";
const TRUNCATED_SUFFIX = "…[truncated]";

function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SENSITIVE_HEADER_KEYS.has(lowered) || SENSITIVE_KEY_PATTERN.test(lowered);
}

function redactString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_SUFFIX}`;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((entry) => redactValue(entry));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ENTRIES);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      result[key] = isSensitiveKey(key) ? REDACTED_MARKER : redactValue(entryValue);
    }
    return result;
  }
  return value;
}

export function redactAttributes(
  attributes: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (attributes === undefined) return undefined;
  return redactValue(attributes) as Record<string, unknown>;
}

export interface RedactedError {
  readonly name: string;
  readonly message: string;
  readonly stack: string | undefined;
}

export function redactError(error: unknown): RedactedError | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactString(error.message),
      stack: error.stack === undefined ? undefined : redactString(singleLine(error.stack)),
    };
  }
  return {
    name: "NonErrorThrow",
    message: redactString(singleLine(String(error))),
    stack: undefined,
  };
}

function singleLine(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " \\n ");
}
