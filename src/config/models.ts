export const DEFAULT_HOMEBASE_PORT = 17106;
export const SUPPORTED_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_CONTRACT_VERSION = 1 as const;
export const SUPPORTED_NODE_MAJOR = 24 as const;

export interface ServerConfiguration {
  readonly port: number;
}

export interface ConfigurationPaths {
  readonly projectRoot: string;
  readonly configFile: string;
  readonly workspaceRoot: string;
  readonly dataRoot: string;
}

export interface ApplicationConfiguration {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly slug: string;
  readonly basePath: `/${string}/`;
  readonly enabled: boolean;
  readonly repoPath: string;
  readonly repositoryRoot: string;
  readonly adapterPath: string;
  readonly adapterFile: string;
  readonly contractVersion: typeof SUPPORTED_CONTRACT_VERSION;
  readonly defaultBranch: string | undefined;
  readonly packageManager: string | undefined;
  readonly devCommands: readonly string[];
  readonly tags: readonly string[];
  readonly icon: string | undefined;
  readonly category: string | undefined;
  readonly sortOrder: number | undefined;
  readonly dataPath: string;
  readonly adapterConfig: Readonly<Record<string, unknown>> | undefined;
  readonly startupIssue:
    | {
        readonly code: "ENABLED_REPOSITORY_MISSING" | "ENABLED_ADAPTER_MISSING";
        readonly message: string;
      }
    | undefined;
}

export interface HomeBaseConfiguration {
  readonly schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  readonly supportedContractVersion: typeof SUPPORTED_CONTRACT_VERSION;
  readonly supportedNodeMajor: typeof SUPPORTED_NODE_MAJOR;
  readonly server: ServerConfiguration;
  readonly paths: ConfigurationPaths;
  readonly applications: readonly ApplicationConfiguration[];
  readonly hostOrigin: string | undefined;
}

export interface RegistryApplication {
  id: string;
  displayName: string;
  description: string;
  slug: string;
  enabled: boolean;
  repoPath: string;
  adapterPath: string;
  contractVersion: number;
  defaultBranch?: string;
  packageManager?: string;
  devCommands?: string[];
  tags?: string[];
  icon?: string;
  category?: string;
  sortOrder?: number;
  adapterConfig?: Record<string, unknown>;
}

export interface RegistryDocument {
  schemaVersion: number;
  server: {
    port: number;
  };
  applications: RegistryApplication[];
}
