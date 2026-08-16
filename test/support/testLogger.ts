import type { ApplicationLogger, LogLevel } from "../../src/contracts/hostedApplication.js";

export interface RecordedLogEntry {
  readonly level: LogLevel;
  readonly event: string;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>> | undefined;
  readonly bindings: Readonly<Record<string, unknown>>;
}

export interface TestLogger extends ApplicationLogger {
  readonly entries: RecordedLogEntry[];
}

function buildLogger(
  entries: RecordedLogEntry[],
  bindings: Readonly<Record<string, unknown>>,
): TestLogger {
  return {
    entries,
    child(childBindings) {
      return buildLogger(entries, { ...bindings, ...childBindings });
    },
    log(level, event, message, context) {
      entries.push({ level, event, message, context, bindings });
    },
    async flush() {
      // Nothing to flush; entries are captured synchronously.
    },
  };
}

export function createTestLogger(bindings: Readonly<Record<string, unknown>> = {}): TestLogger {
  return buildLogger([], bindings);
}
