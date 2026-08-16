import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import {
  ConfigurationError,
  type ConfigurationIssue,
} from "../config/ConfigurationError.js";
import { deepFreeze } from "../config/deepFreeze.js";
import {
  DEFAULT_HOMEBASE_PORT,
  SUPPORTED_CONTRACT_VERSION,
  SUPPORTED_NODE_MAJOR,
  SUPPORTED_SCHEMA_VERSION,
  type ApplicationConfiguration,
  type HomeBaseConfiguration,
  type RegistryApplication,
  type RegistryDocument,
  type ServerConfiguration,
} from "../config/models.js";

const RESERVED_SLUGS = new Set(["api", "assets", "health", "ready"]);
const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_CONFIG_RELATIVE_PATH = "config/homebase.json";
const DEFAULT_SCHEMA_RELATIVE_PATH = "config/homebase.schema.json";

export interface ConfigServiceLoadOptions {
  readonly projectRoot?: string;
  readonly schemaPath?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion?: string;
}

interface ConfigurationSources {
  readonly port: "default" | "registry" | "environment";
  readonly configFile: "default" | "environment";
  readonly workspaceRoot: "environment";
}

interface ExistingAncestor {
  readonly canonicalPath: string;
}

export class ConfigService {
  static readonly defaultPort = DEFAULT_HOMEBASE_PORT;
  static readonly supportedSchemaVersion = SUPPORTED_SCHEMA_VERSION;
  static readonly supportedContractVersion = SUPPORTED_CONTRACT_VERSION;
  static readonly supportedNodeMajor = SUPPORTED_NODE_MAJOR;

  readonly #configuration: HomeBaseConfiguration;
  readonly #applicationById: ReadonlyMap<string, ApplicationConfiguration>;
  readonly #sources: ConfigurationSources;

  private constructor(
    configuration: HomeBaseConfiguration,
    sources: ConfigurationSources,
  ) {
    this.#configuration = deepFreeze(configuration) as HomeBaseConfiguration;
    this.#applicationById = new Map(
      configuration.applications.map((application) => [application.id, application]),
    );
    this.#sources = Object.freeze(sources);
    Object.freeze(this);
  }

  static async load(options: ConfigServiceLoadOptions = {}): Promise<ConfigService> {
    const projectRoot = path.resolve(options.projectRoot ?? PROJECT_ROOT);
    const environment = options.environment ?? process.env;
    const nodeVersion = options.nodeVersion ?? process.versions.node;
    const schemaPath = path.resolve(
      options.schemaPath ?? path.join(projectRoot, DEFAULT_SCHEMA_RELATIVE_PATH),
    );

    validateNodeVersion(nodeVersion);

    const configOverride = environment.HOMEBASE_CONFIG_PATH;
    if (configOverride !== undefined && configOverride.trim().length === 0) {
      throw new ConfigurationError([
        {
          code: "ENVIRONMENT_VALUE_INVALID",
          path: "HOMEBASE_CONFIG_PATH",
          message: "Use a non-empty absolute or project-root-relative file path.",
        },
      ]);
    }
    const configFile = configOverride
      ? path.resolve(projectRoot, configOverride)
      : path.join(projectRoot, DEFAULT_CONFIG_RELATIVE_PATH);
    const registry = await readAndValidateRegistry(configFile, schemaPath);
    const effectivePort = resolvePort(registry.server.port, environment.HOMEBASE_PORT);
    const workspaceRoot = await resolveWorkspaceRoot(
      environment.HOMEBASE_WORKSPACE_PATH,
    );
    const applications = await normalizeApplications(
      registry.applications,
      workspaceRoot,
    );

    const configuration: HomeBaseConfiguration = {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      supportedContractVersion: SUPPORTED_CONTRACT_VERSION,
      supportedNodeMajor: SUPPORTED_NODE_MAJOR,
      server: { port: effectivePort },
      paths: {
        projectRoot,
        configFile,
        workspaceRoot,
      },
      applications,
    };
    const sources: ConfigurationSources = {
      port: environment.HOMEBASE_PORT === undefined ? "registry" : "environment",
      configFile: configOverride === undefined ? "default" : "environment",
      workspaceRoot: "environment",
    };

    return new ConfigService(configuration, sources);
  }

  get configuration(): HomeBaseConfiguration {
    return this.#configuration;
  }

  get server(): ServerConfiguration {
    return this.#configuration.server;
  }

  get projectRoot(): string {
    return this.#configuration.paths.projectRoot;
  }

  get configFile(): string {
    return this.#configuration.paths.configFile;
  }

  get workspaceRoot(): string {
    return this.#configuration.paths.workspaceRoot;
  }

  get applications(): readonly ApplicationConfiguration[] {
    return this.#configuration.applications;
  }

  getApplication(id: string): ApplicationConfiguration | undefined {
    return this.#applicationById.get(id);
  }

  // Provenance is intentionally kept inside the service for future diagnostics.
  getSource(setting: keyof ConfigurationSources): ConfigurationSources[typeof setting] {
    return this.#sources[setting];
  }
}

function validateNodeVersion(nodeVersion: string): void {
  const majorText = nodeVersion.split(".", 1)[0];
  const major = Number(majorText);
  if (!Number.isInteger(major) || major !== SUPPORTED_NODE_MAJOR) {
    throw new ConfigurationError([
      {
        code: "RUNTIME_VERSION_UNSUPPORTED",
        path: "runtime.nodeVersion",
        message: `Node.js major version ${SUPPORTED_NODE_MAJOR} is required.`,
      },
    ]);
  }
}

async function resolveWorkspaceRoot(value: string | undefined): Promise<string> {
  if (value === undefined || value.length === 0) {
    throw new ConfigurationError([
      {
        code: "ENVIRONMENT_VALUE_REQUIRED",
        path: "HOMEBASE_WORKSPACE_PATH",
        message: "Set an absolute workspace directory path.",
      },
    ]);
  }
  if (!path.isAbsolute(value)) {
    throw new ConfigurationError([
      {
        code: "ENVIRONMENT_VALUE_INVALID",
        path: "HOMEBASE_WORKSPACE_PATH",
        message: "The workspace path must be absolute.",
      },
    ]);
  }

  try {
    const details = await stat(value);
    if (!details.isDirectory()) {
      throw new Error("not a directory");
    }
    return await realpath(value);
  } catch {
    throw new ConfigurationError([
      {
        code: "ENVIRONMENT_VALUE_INVALID",
        path: "HOMEBASE_WORKSPACE_PATH",
        message: "The workspace path must identify an existing directory.",
      },
    ]);
  }
}

async function readAndValidateRegistry(
  configFile: string,
  schemaPath: string,
): Promise<RegistryDocument> {
  let registryText: string;
  let schemaText: string;
  try {
    [registryText, schemaText] = await Promise.all([
      readFile(configFile, "utf8"),
      readFile(schemaPath, "utf8"),
    ]);
  } catch {
    throw new ConfigurationError([
      {
        code: "CONFIG_FILE_READ_FAILED",
        path: "configurationFile",
        message: "The configuration or schema file could not be read.",
      },
    ]);
  }

  let registry: unknown;
  let schema: object;
  try {
    registry = JSON.parse(registryText) as unknown;
    schema = JSON.parse(schemaText) as object;
  } catch {
    throw new ConfigurationError([
      {
        code: "CONFIG_JSON_INVALID",
        path: "configurationFile",
        message: "The configuration or schema file is not valid JSON.",
      },
    ]);
  }

  let validate: ValidateFunction<RegistryDocument>;
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validate = ajv.compile<RegistryDocument>(schema);
  } catch {
    throw new ConfigurationError([
      {
        code: "CONFIG_SCHEMA_INVALID",
        path: "configurationSchema",
        message: "The HomeBase configuration schema could not be compiled.",
      },
    ]);
  }
  if (!validate(registry)) {
    throw new ConfigurationError(schemaIssues(validate.errors ?? []));
  }

  const semanticIssues = validateRegistrySemantics(registry);
  if (semanticIssues.length > 0) {
    throw new ConfigurationError(semanticIssues);
  }
  return registry;
}

function schemaIssues(errors: readonly ErrorObject[]): ConfigurationIssue[] {
  return errors.map((error) => ({
    code: "CONFIG_SCHEMA_INVALID",
    path: error.instancePath.length > 0 ? error.instancePath : "/",
    message: error.message ?? "The value does not match the registry schema.",
  }));
}

function validateRegistrySemantics(registry: RegistryDocument): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();

  registry.applications.forEach((application, index) => {
    const root = `/applications/${index}`;
    if (ids.has(application.id)) {
      issues.push({
        code: "DUPLICATE_APPLICATION_ID",
        path: `${root}/id`,
        message: `Application ID '${application.id}' is already registered.`,
      });
    }
    ids.add(application.id);

    if (slugs.has(application.slug)) {
      issues.push({
        code: "DUPLICATE_APPLICATION_SLUG",
        path: `${root}/slug`,
        message: `Application slug '${application.slug}' is already registered.`,
      });
    }
    slugs.add(application.slug);

    if (RESERVED_SLUGS.has(application.slug)) {
      issues.push({
        code: "RESERVED_APPLICATION_SLUG",
        path: `${root}/slug`,
        message: `Application slug '${application.slug}' is reserved by HomeBase.`,
      });
    }

    for (const [field, value] of [
      ["repoPath", application.repoPath],
      ["adapterPath", application.adapterPath],
    ] as const) {
      if (!isCanonicalRelativePath(value)) {
        issues.push({
          code: "PATH_INVALID",
          path: `${root}/${field}`,
          message: "Use a canonical forward-slash relative path without traversal.",
        });
      }
    }

    for (const [field, value] of stringValues(application)) {
      if (value.trim().length === 0) {
        issues.push({
          code: "CONFIG_SCHEMA_INVALID",
          path: `${root}/${field}`,
          message: "The value must contain non-whitespace characters.",
        });
      }
    }
  });

  return issues;
}

function stringValues(
  application: RegistryApplication,
): ReadonlyArray<readonly [string, string]> {
  const values: Array<readonly [string, string]> = [
    ["displayName", application.displayName],
    ["description", application.description],
  ];
  for (const field of ["defaultBranch", "packageManager", "icon", "category"] as const) {
    const value = application[field];
    if (value !== undefined) values.push([field, value]);
  }
  application.devCommands?.forEach((value, index) =>
    values.push([`devCommands/${index}`, value]),
  );
  application.tags?.forEach((value, index) => values.push([`tags/${index}`, value]));
  return values;
}

function isCanonicalRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    /%2f|%5c/i.test(value) ||
    /^[a-zA-Z]:/.test(value) ||
    path.posix.isAbsolute(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    path.posix.normalize(value) === value
  );
}

function resolvePort(registryPort: number, override: string | undefined): number {
  if (override === undefined) return registryPort;
  if (!/^[1-9][0-9]*$/.test(override)) {
    throw invalidPortError();
  }
  const port = Number(override);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw invalidPortError();
  }
  return port;
}

function invalidPortError(): ConfigurationError {
  return new ConfigurationError([
    {
      code: "ENVIRONMENT_VALUE_INVALID",
      path: "HOMEBASE_PORT",
      message: "Use a base-10 integer from 1 through 65535.",
    },
  ]);
}

async function normalizeApplications(
  applications: readonly RegistryApplication[],
  workspaceRoot: string,
): Promise<readonly ApplicationConfiguration[]> {
  const normalized: ApplicationConfiguration[] = [];
  for (const [index, application] of applications.entries()) {
    const repositoryRoot = resolveContained(
      workspaceRoot,
      application.repoPath,
      `/applications/${index}/repoPath`,
    );
    await validateCanonicalContainment(
      workspaceRoot,
      repositoryRoot,
      `/applications/${index}/repoPath`,
    );
    const adapterFile = resolveContained(
      repositoryRoot,
      application.adapterPath,
      `/applications/${index}/adapterPath`,
    );
    if (await pathEntryExists(repositoryRoot)) {
      await validateCanonicalContainment(
        repositoryRoot,
        adapterFile,
        `/applications/${index}/adapterPath`,
      );
    }

    if (application.enabled) {
      await requireEnabledRepository(repositoryRoot, index);
      await requireEnabledAdapter(adapterFile, index);
    }

    normalized.push({
      id: application.id,
      displayName: application.displayName,
      description: application.description,
      slug: application.slug,
      basePath: `/${application.slug}/`,
      enabled: application.enabled,
      repoPath: application.repoPath,
      repositoryRoot,
      adapterPath: application.adapterPath,
      adapterFile,
      contractVersion: SUPPORTED_CONTRACT_VERSION,
      defaultBranch: application.defaultBranch,
      packageManager: application.packageManager,
      devCommands: application.devCommands ?? [],
      tags: application.tags ?? [],
      icon: application.icon,
      category: application.category,
      sortOrder: application.sortOrder,
    });
  }
  return normalized;
}

function resolveContained(parent: string, relative: string, issuePath: string): string {
  const candidate = path.resolve(parent, ...relative.split("/"));
  const relation = path.relative(parent, candidate);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new ConfigurationError([
      {
        code: "PATH_ESCAPES_PARENT",
        path: issuePath,
        message: "The resolved path must remain beneath its configured parent.",
      },
    ]);
  }
  return candidate;
}

async function validateCanonicalContainment(
  parent: string,
  candidate: string,
  issuePath: string,
): Promise<void> {
  let canonicalParent: string;
  let ancestor: ExistingAncestor;
  try {
    canonicalParent = await realpath(parent);
    ancestor = await findExistingAncestor(candidate);
  } catch {
    throw new ConfigurationError([
      {
        code: "PATH_INVALID",
        path: issuePath,
        message: "An existing path component could not be resolved safely.",
      },
    ]);
  }
  const relation = path.relative(canonicalParent, ancestor.canonicalPath);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new ConfigurationError([
      {
        code: "PATH_ESCAPES_PARENT",
        path: issuePath,
        message: "An existing path component resolves outside its configured parent.",
      },
    ]);
  }
}

async function pathEntryExists(value: string): Promise<boolean> {
  try {
    await lstat(value);
    return true;
  } catch (cause) {
    if (isMissing(cause)) return false;
    throw cause;
  }
}

async function findExistingAncestor(candidate: string): Promise<ExistingAncestor> {
  let cursor = candidate;
  while (true) {
    try {
      await lstat(cursor);
      return { canonicalPath: await realpath(cursor) };
    } catch (cause) {
      if (!isMissing(cause)) throw cause;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw cause;
      cursor = parent;
    }
  }
}

function isMissing(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}

async function requireEnabledRepository(repositoryRoot: string, index: number): Promise<void> {
  try {
    const details = await stat(repositoryRoot);
    if (!details.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new ConfigurationError([
      {
        code: "ENABLED_REPOSITORY_MISSING",
        path: `/applications/${index}/repoPath`,
        message: "An enabled application requires an existing repository directory.",
      },
    ]);
  }
}

async function requireEnabledAdapter(adapterFile: string, index: number): Promise<void> {
  try {
    await access(adapterFile);
    const details = await stat(adapterFile);
    if (!details.isFile()) throw new Error("not a file");
  } catch {
    throw new ConfigurationError([
      {
        code: "ENABLED_ADAPTER_MISSING",
        path: `/applications/${index}/adapterPath`,
        message: "An enabled application requires an existing compiled adapter file.",
      },
    ]);
  }
}
