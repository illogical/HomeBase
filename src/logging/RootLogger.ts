import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ApplicationLogger, LogLevel } from "../contracts/hostedApplication.js";
import { NdjsonSink } from "./NdjsonSink.js";
import { redactAttributes, redactError } from "./redact.js";
import { currentRequestId } from "./requestContext.js";

const LEVEL_ORDER: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

function levelRank(level: LogLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && (LEVEL_ORDER as readonly string[]).includes(value);
}

export interface RootLoggerCreateOptions {
  readonly dataRoot: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly sink?: NdjsonSink;
}

interface FixedBindings {
  readonly serviceName: "homebase";
  readonly serviceInstanceId: string;
  readonly applicationId: string | undefined;
  readonly component: string | undefined;
}

export class RootLogger implements ApplicationLogger {
  readonly #sink: NdjsonSink;
  readonly #minLevel: LogLevel;
  readonly #mirrorToConsole: boolean;
  readonly #bindings: FixedBindings;

  private constructor(
    sink: NdjsonSink,
    minLevel: LogLevel,
    mirrorToConsole: boolean,
    bindings: FixedBindings,
  ) {
    this.#sink = sink;
    this.#minLevel = minLevel;
    this.#mirrorToConsole = mirrorToConsole;
    this.#bindings = bindings;
  }

  static create(options: RootLoggerCreateOptions): RootLogger {
    const environment = options.environment ?? process.env;
    const sink =
      options.sink ?? new NdjsonSink(join(options.dataRoot, "homebase", "log", "homebase.ndjson"));
    const minLevel = isLogLevel(environment.HOMEBASE_LOG_LEVEL)
      ? environment.HOMEBASE_LOG_LEVEL
      : "info";
    const mirrorToConsole = environment.NODE_ENV !== "production";
    return new RootLogger(sink, minLevel, mirrorToConsole, {
      serviceName: "homebase",
      serviceInstanceId: randomUUID(),
      applicationId: undefined,
      component: undefined,
    });
  }

  get degraded(): boolean {
    return this.#sink.degraded;
  }

  child(bindings: Readonly<Record<string, unknown>>): ApplicationLogger {
    const applicationId =
      this.#bindings.applicationId ??
      (typeof bindings.applicationId === "string" ? bindings.applicationId : undefined);
    const component =
      typeof bindings.component === "string" ? bindings.component : this.#bindings.component;
    return new RootLogger(this.#sink, this.#minLevel, this.#mirrorToConsole, {
      serviceName: "homebase",
      serviceInstanceId: this.#bindings.serviceInstanceId,
      applicationId,
      component,
    });
  }

  log(
    level: LogLevel,
    event: string,
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ): void {
    if (levelRank(level) < levelRank(this.#minLevel)) return;

    const { error: rawError, ...rawAttributes } = context ?? {};
    const record = {
      timestamp: new Date().toISOString(),
      severityText: level,
      body: message,
      eventName: event,
      serviceName: this.#bindings.serviceName,
      serviceInstanceId: this.#bindings.serviceInstanceId,
      applicationId: this.#bindings.applicationId,
      component: this.#bindings.component,
      requestId: currentRequestId(),
      attributes:
        Object.keys(rawAttributes).length > 0 ? redactAttributes(rawAttributes) : undefined,
      error: redactError(rawError),
    };

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        ...record,
        attributes: undefined,
        error: { name: "SerializationError", message: "Attributes could not be serialized." },
      });
    }
    this.#sink.write(line);

    if (this.#mirrorToConsole && levelRank(level) >= levelRank("info")) {
      const consoleMethod = level === "error" || level === "fatal" ? console.error : console.log;
      consoleMethod(`[${level}] ${event}: ${message}`);
    }
  }

  async flush(deadlineMs = 2000): Promise<void> {
    await this.#sink.flush(deadlineMs);
  }
}
