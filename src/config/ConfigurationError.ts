export type ConfigurationIssueCode =
  | "CONFIG_FILE_READ_FAILED"
  | "CONFIG_JSON_INVALID"
  | "CONFIG_SCHEMA_INVALID"
  | "DUPLICATE_APPLICATION_ID"
  | "DUPLICATE_APPLICATION_SLUG"
  | "ENABLED_ADAPTER_MISSING"
  | "ENABLED_REPOSITORY_MISSING"
  | "ENVIRONMENT_VALUE_INVALID"
  | "ENVIRONMENT_VALUE_REQUIRED"
  | "PATH_ESCAPES_PARENT"
  | "PATH_INVALID"
  | "RESERVED_APPLICATION_SLUG"
  | "RUNTIME_VERSION_UNSUPPORTED";

export interface ConfigurationIssue {
  readonly code: ConfigurationIssueCode;
  readonly path: string;
  readonly message: string;
}

export class ConfigurationError extends Error {
  readonly code = "HOMEBASE_CONFIGURATION_INVALID" as const;
  readonly issues: readonly ConfigurationIssue[];

  constructor(issues: readonly ConfigurationIssue[]) {
    super(formatIssues(issues));
    this.name = "ConfigurationError";
    this.issues = Object.freeze([...issues]);
  }
}

function formatIssues(issues: readonly ConfigurationIssue[]): string {
  const summary = issues
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
    .join("; ");
  return `HomeBase configuration is invalid: ${summary}`;
}
