export const HOSTED_CONTRACT_VERSION = 1 as const;

export type ApplicationLifecycleState =
  | "disabled"
  | "loading"
  | "initializing"
  | "ready"
  | "degraded"
  | "unavailable"
  | "stopping";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface ApplicationLogger {
  child(bindings: Readonly<Record<string, unknown>>): ApplicationLogger;
  log(
    level: LogLevel,
    event: string,
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ): void;
  flush?(): Promise<void>;
}

export interface HostedApplicationStatus {
  readonly state: "ready" | "degraded";
  readonly summary: string;
  readonly since: string; // ISO-8601
}

export interface ActiveWorkStatus {
  readonly hasActiveWork: boolean;
  readonly description?: string;
}

export type Disposer = () => Promise<void> | void;

export interface HostedApplicationOptions {
  readonly applicationId: string;
  readonly repositoryRoot: string;
  readonly basePath: `/${string}/`;
  readonly hostOrigin: string | undefined;
  readonly dataPath: string;
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly logger: ApplicationLogger;
}

export interface HostedApplication {
  readonly contractVersion: typeof HOSTED_CONTRACT_VERSION;
  initialize?(): Promise<void>;
  router?: import("express").Router;
  staticAssets?: { readonly directory: string; readonly spaFallback: boolean };
  attachRealtime?(server: import("node:http").Server): Promise<Disposer | void>;
  getStatus(): Promise<HostedApplicationStatus>;
  getActiveWork?(): Promise<ActiveWorkStatus>;
  dispose?(): Promise<void>;
}

export type CreateHostedApplication = (
  options: HostedApplicationOptions,
) => HostedApplication;
