import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigurationError,
  type ConfigurationIssueCode,
} from "../src/config/ConfigurationError.js";
import { ConfigService } from "../src/services/ConfigService.js";
import {
  createConfigFixture,
  type ConfigFixture,
  validRegistry,
} from "./support/configFixture.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtures: ConfigFixture[] = [];
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function fixture(): Promise<ConfigFixture> {
  const created = await createConfigFixture();
  fixtures.push(created);
  return created;
}

async function load(
  current: ConfigFixture,
  environment: Readonly<Record<string, string | undefined>> = {
    HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
    HOMEBASE_DATA_PATH: current.dataRoot,
  },
  nodeVersion = "24.0.0",
): Promise<ConfigService> {
  return ConfigService.load({
    projectRoot: current.projectRoot,
    environment,
    nodeVersion,
  });
}

async function expectIssue(
  operation: Promise<unknown>,
  code: ConfigurationIssueCode,
  issuePath?: string,
): Promise<ConfigurationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    const configurationError = error as ConfigurationError;
    expect(configurationError.code).toBe("HOMEBASE_CONFIGURATION_INVALID");
    expect(configurationError.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code,
          ...(issuePath === undefined ? {} : { path: issuePath }),
        }),
      ]),
    );
    return configurationError;
  }
  throw new Error("Expected configuration loading to fail.");
}

describe("ConfigService", () => {
  it("loads a deterministic, deeply immutable model in registry order", async () => {
    const current = await fixture();
    await current.writeRegistry(validRegistry());

    const service = await load(current);

    expect(service.server.port).toBe(17000);
    expect(service.applications.map(({ id }) => id)).toEqual(["first-app", "second-app"]);
    expect(service.applications.map(({ sortOrder }) => sortOrder)).toEqual([20, 10]);
    expect(service.getApplication("first-app")).toBe(service.applications[0]);
    expect(service.getApplication("missing")).toBeUndefined();
    expect(service.applications[0]).toMatchObject({
      basePath: "/first-app/",
      repositoryRoot: path.join(service.workspaceRoot, "FirstApp"),
      adapterFile: path.join(service.workspaceRoot, "FirstApp/dist/host/index.js"),
    });
    expect(Object.isFrozen(service)).toBe(true);
    expect(Object.isFrozen(service.configuration)).toBe(true);
    expect(Object.isFrozen(service.applications)).toBe(true);
    expect(Object.isFrozen(service.applications[0]?.devCommands)).toBe(true);
    expect(service.getSource("port")).toBe("registry");
  });

  it("applies registry values over defaults and environment values last", async () => {
    const current = await fixture();
    const registry = validRegistry();
    registry.server.port = 18000;
    await current.writeRegistry(registry);

    const service = await load(current, {
      HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
      HOMEBASE_DATA_PATH: current.dataRoot,
      HOMEBASE_PORT: "19000",
    });

    expect(ConfigService.defaultPort).toBe(17106);
    expect(service.server.port).toBe(19000);
    expect(service.getSource("port")).toBe("environment");
  });

  it("resolves relative config overrides from the project root", async () => {
    const current = await fixture();
    const alternate = path.join(current.projectRoot, "settings/local.json");
    await mkdir(path.dirname(alternate), { recursive: true });
    await writeFile(alternate, JSON.stringify(validRegistry()), "utf8");

    const service = await load(current, {
      HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
      HOMEBASE_DATA_PATH: current.dataRoot,
      HOMEBASE_CONFIG_PATH: "settings/local.json",
    });

    expect(service.configFile).toBe(alternate);
    expect(service.getSource("configFile")).toBe("environment");
  });

  it("rejects an empty config path override", async () => {
    const current = await fixture();
    await current.writeRegistry(validRegistry());
    await expectIssue(
      load(current, {
        HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
        HOMEBASE_DATA_PATH: current.dataRoot,
        HOMEBASE_CONFIG_PATH: "   ",
      }),
      "ENVIRONMENT_VALUE_INVALID",
      "HOMEBASE_CONFIG_PATH",
    );
  });

  it("loads the tracked public example without requiring disabled output", async () => {
    const current = await fixture();
    const example = await readFile(
      path.join(repositoryRoot, "config/homebase.example.json"),
      "utf8",
    );
    await writeFile(current.configFile, example, "utf8");

    const service = await load(current);

    expect(service.applications).toHaveLength(1);
    expect(service.applications[0]).toMatchObject({ id: "example-app", enabled: false });
  });

  it.each(["", "0", "65536", "1.5", " 17106", "+17106", "abc"])(
    "rejects invalid HOMEBASE_PORT value %j",
    async (port) => {
      const current = await fixture();
      await current.writeRegistry(validRegistry());
      await expectIssue(
        load(current, {
          HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
          HOMEBASE_DATA_PATH: current.dataRoot,
          HOMEBASE_PORT: port,
        }),
        "ENVIRONMENT_VALUE_INVALID",
        "HOMEBASE_PORT",
      );
    },
  );

  it("requires an absolute existing workspace directory", async () => {
    const current = await fixture();
    await current.writeRegistry(validRegistry());
    await expectIssue(
      load(current, { HOMEBASE_DATA_PATH: current.dataRoot }),
      "ENVIRONMENT_VALUE_REQUIRED",
      "HOMEBASE_WORKSPACE_PATH",
    );
    await expectIssue(
      load(current, {
        HOMEBASE_WORKSPACE_PATH: "relative",
        HOMEBASE_DATA_PATH: current.dataRoot,
      }),
      "ENVIRONMENT_VALUE_INVALID",
      "HOMEBASE_WORKSPACE_PATH",
    );
    const filePath = path.join(current.root, "not-a-directory");
    await writeFile(filePath, "file", "utf8");
    await expectIssue(
      load(current, {
        HOMEBASE_WORKSPACE_PATH: filePath,
        HOMEBASE_DATA_PATH: current.dataRoot,
      }),
      "ENVIRONMENT_VALUE_INVALID",
      "HOMEBASE_WORKSPACE_PATH",
    );
  });

  it("requires an absolute existing data directory", async () => {
    const current = await fixture();
    await current.writeRegistry(validRegistry());
    await expectIssue(
      load(current, { HOMEBASE_WORKSPACE_PATH: current.workspaceRoot }),
      "ENVIRONMENT_VALUE_REQUIRED",
      "HOMEBASE_DATA_PATH",
    );
    await expectIssue(
      load(current, {
        HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
        HOMEBASE_DATA_PATH: "relative",
      }),
      "ENVIRONMENT_VALUE_INVALID",
      "HOMEBASE_DATA_PATH",
    );
    const filePath = path.join(current.root, "not-a-directory-data");
    await writeFile(filePath, "file", "utf8");
    await expectIssue(
      load(current, {
        HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
        HOMEBASE_DATA_PATH: filePath,
      }),
      "ENVIRONMENT_VALUE_INVALID",
      "HOMEBASE_DATA_PATH",
    );
  });

  it.each(["", "   "])("rejects an empty HOMEBASE_PUBLIC_ORIGIN value %j", async (value) => {
    const current = await fixture();
    await current.writeRegistry(validRegistry());
    await expectIssue(
      load(current, {
        HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
        HOMEBASE_DATA_PATH: current.dataRoot,
        HOMEBASE_PUBLIC_ORIGIN: value,
      }),
      "ENVIRONMENT_VALUE_INVALID",
      "HOMEBASE_PUBLIC_ORIGIN",
    );
  });

  it("threads an optional HOMEBASE_PUBLIC_ORIGIN through as hostOrigin", async () => {
    const current = await fixture();
    await current.writeRegistry(validRegistry());
    const service = await load(current, {
      HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
      HOMEBASE_DATA_PATH: current.dataRoot,
      HOMEBASE_PUBLIC_ORIGIN: "https://homebase.example",
    });
    expect(service.hostOrigin).toBe("https://homebase.example");
  });

  it("computes a per-application data path beneath the data root", async () => {
    const current = await fixture();
    await current.writeRegistry(validRegistry());
    const service = await load(current);
    expect(service.applications[0]?.dataPath).toBe(
      path.join(current.dataRoot, "apps", "first-app"),
    );
  });

  it("rejects an unsupported Node major before reading configuration", async () => {
    const current = await fixture();
    await expectIssue(load(current, {}, "26.0.0"), "RUNTIME_VERSION_UNSUPPORTED");
  });

  it("reports missing and malformed registry files without leaking values", async () => {
    const current = await fixture();
    const missing = await expectIssue(
      load(current),
      "CONFIG_FILE_READ_FAILED",
      "configurationFile",
    );
    expect(missing.message).not.toContain(current.workspaceRoot);
    expect(missing.cause).toBeUndefined();

    await writeFile(current.configFile, "{not-json", "utf8");
    await expectIssue(load(current), "CONFIG_JSON_INVALID", "configurationFile");
  });

  it("reports a non-file registry path as a file-read failure", async () => {
    const current = await fixture();
    const registryDirectory = path.join(current.projectRoot, "settings");
    await mkdir(registryDirectory);

    await expectIssue(
      load(current, {
        HOMEBASE_WORKSPACE_PATH: current.workspaceRoot,
        HOMEBASE_DATA_PATH: current.dataRoot,
        HOMEBASE_CONFIG_PATH: registryDirectory,
      }),
      "CONFIG_FILE_READ_FAILED",
      "configurationFile",
    );
  });

  it.each([
    ["unknown root field", (registry: Record<string, unknown>) => (registry.extra = true)],
    ["missing server", (registry: Record<string, unknown>) => delete registry.server],
    ["unsupported schema", (registry: Record<string, unknown>) => (registry.schemaVersion = 2)],
    [
      "unsupported contract",
      (registry: Record<string, unknown>) =>
        (((registry.applications as Array<Record<string, unknown>>)[0] as Record<string, unknown>)[
          "contractVersion"
        ] = 2),
    ],
    [
      "malformed slug",
      (registry: Record<string, unknown>) =>
        (((registry.applications as Array<Record<string, unknown>>)[0] as Record<string, unknown>)[
          "slug"
        ] = "nested/app"),
    ],
    [
      "duplicate command",
      (registry: Record<string, unknown>) =>
        (((registry.applications as Array<Record<string, unknown>>)[0] as Record<string, unknown>)[
          "devCommands"
        ] = ["npm test", "npm test"]),
    ],
  ])("rejects schema violation: %s", async (_name, mutate) => {
    const current = await fixture();
    const registry = structuredClone(validRegistry()) as unknown as Record<string, unknown>;
    mutate(registry);
    await current.writeRegistry(registry);
    await expectIssue(load(current), "CONFIG_SCHEMA_INVALID");
  });

  it.each(["Uppercase", "nested/app", "encoded%2fpath", "query?value", "fragment#value"])(
    "rejects noncanonical slug %j",
    async (slug) => {
      const current = await fixture();
      const registry = validRegistry();
      registry.applications[0]!.slug = slug;
      await current.writeRegistry(registry);
      await expectIssue(load(current), "CONFIG_SCHEMA_INVALID", "/applications/0/slug");
    },
  );

  it("reports duplicate IDs and slugs and reserved routes", async () => {
    const current = await fixture();
    const registry = validRegistry();
    registry.applications[1]!.id = registry.applications[0]!.id;
    registry.applications[1]!.slug = registry.applications[0]!.slug;
    registry.applications.push({
      ...registry.applications[0]!,
      id: "reserved-app",
      slug: "api",
    });
    await current.writeRegistry(registry);

    const error = await expectIssue(load(current), "DUPLICATE_APPLICATION_ID");
    expect(error.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_APPLICATION_SLUG",
        "RESERVED_APPLICATION_SLUG",
      ]),
    );
  });

  it.each<[string, ConfigurationIssueCode]>([
    ["/absolute", "CONFIG_SCHEMA_INVALID"],
    ["../escape", "CONFIG_SCHEMA_INVALID"],
    [".", "CONFIG_SCHEMA_INVALID"],
    ["folder/../escape", "CONFIG_SCHEMA_INVALID"],
    ["folder\\escape", "CONFIG_SCHEMA_INVALID"],
    ["C:/windows", "PATH_INVALID"],
    ["folder//child", "PATH_INVALID"],
    ["folder/%2fescape", "PATH_INVALID"],
    ["folder?query", "PATH_INVALID"],
  ])("rejects unsafe repository path %j", async (repoPath, expectedCode) => {
    const current = await fixture();
    const registry = validRegistry();
    registry.applications[0]!.repoPath = repoPath;
    await current.writeRegistry(registry);
    await expectIssue(load(current), expectedCode);
  });

  it.each<[string, ConfigurationIssueCode]>([
    ["/absolute.js", "CONFIG_SCHEMA_INVALID"],
    ["../escape.js", "CONFIG_SCHEMA_INVALID"],
    ["dist\\host.js", "CONFIG_SCHEMA_INVALID"],
    ["C:/host.js", "PATH_INVALID"],
    ["dist/%2fhost.js", "PATH_INVALID"],
    ["dist/host.js?query", "PATH_INVALID"],
  ])(
    "rejects unsafe adapter path %j",
    async (adapterPath, expectedCode) => {
      const current = await fixture();
      const registry = validRegistry();
      registry.applications[0]!.adapterPath = adapterPath;
      await current.writeRegistry(registry);
      await expectIssue(load(current), expectedCode);
    },
  );

  it("rejects repository and adapter symlink escapes", async () => {
    const current = await fixture();
    const outside = path.join(current.root, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      path.join(current.workspaceRoot, "EscapingRepo"),
      directoryLinkType,
    );
    const registry = validRegistry();
    registry.applications[0]!.repoPath = "EscapingRepo";
    await current.writeRegistry(registry);
    await expectIssue(load(current), "PATH_ESCAPES_PARENT", "/applications/0/repoPath");

    registry.applications[0]!.repoPath = "ContainedRepo";
    await mkdir(path.join(current.workspaceRoot, "ContainedRepo"));
    await symlink(
      outside,
      path.join(current.workspaceRoot, "ContainedRepo/dist"),
      directoryLinkType,
    );
    await current.writeRegistry(registry);
    await expectIssue(load(current), "PATH_ESCAPES_PARENT", "/applications/0/adapterPath");
  });

  it("reports enabled repository/adapter gaps per-app without importing the adapter", async () => {
    const current = await fixture();
    const registry = validRegistry();
    registry.applications = [registry.applications[0]!];
    registry.applications[0]!.enabled = true;
    await current.writeRegistry(registry);
    const missingRepo = await load(current);
    expect(missingRepo.applications[0]?.startupIssue).toEqual(
      expect.objectContaining({ code: "ENABLED_REPOSITORY_MISSING" }),
    );

    const repository = path.join(current.workspaceRoot, "FirstApp");
    await mkdir(repository);
    const missingAdapter = await load(current);
    expect(missingAdapter.applications[0]?.startupIssue).toEqual(
      expect.objectContaining({ code: "ENABLED_ADAPTER_MISSING" }),
    );

    const adapter = path.join(repository, "dist/host/index.js");
    const marker = path.join(current.root, "adapter-imported");
    await mkdir(path.dirname(adapter), { recursive: true });
    await writeFile(
      adapter,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "bad");`,
      "utf8",
    );
    const service = await load(current);
    expect(service.applications[0]?.enabled).toBe(true);
    expect(service.applications[0]?.startupIssue).toBeUndefined();
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not discover unregistered folders or execute devCommands", async () => {
    const current = await fixture();
    const marker = path.join(current.root, "command-ran");
    const registry = validRegistry();
    registry.applications = [registry.applications[0]!];
    registry.applications[0]!.devCommands = [`touch ${marker}`];
    await mkdir(path.join(current.workspaceRoot, "Unregistered/package"), { recursive: true });
    await current.writeRegistry(registry);

    const service = await load(current);

    expect(service.applications.map(({ id }) => id)).toEqual(["first-app"]);
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
