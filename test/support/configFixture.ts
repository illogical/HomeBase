import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistryDocument } from "../../src/config/models.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export interface ConfigFixture {
  readonly root: string;
  readonly projectRoot: string;
  readonly workspaceRoot: string;
  readonly dataRoot: string;
  readonly configFile: string;
  readonly schemaFile: string;
  writeRegistry(registry: unknown): Promise<void>;
  cleanup(): Promise<void>;
}

export function validRegistry(): RegistryDocument {
  return {
    schemaVersion: 1,
    server: { port: 17000 },
    applications: [
      {
        id: "first-app",
        displayName: "First App",
        description: "The first configured application.",
        slug: "first-app",
        enabled: false,
        repoPath: "FirstApp",
        adapterPath: "dist/host/index.js",
        contractVersion: 1,
        devCommands: ["npm run dev"],
        tags: ["first"],
        sortOrder: 20,
      },
      {
        id: "second-app",
        displayName: "Second App",
        description: "The second configured application.",
        slug: "second-app",
        enabled: false,
        repoPath: "SecondApp",
        adapterPath: "dist/host/index.js",
        contractVersion: 1,
        sortOrder: 10,
      },
    ],
  };
}

export async function createConfigFixture(): Promise<ConfigFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "homebase-config-"));
  const projectRoot = path.join(root, "HomeBase");
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  const configDirectory = path.join(projectRoot, "config");
  const configFile = path.join(configDirectory, "homebase.json");
  const schemaFile = path.join(configDirectory, "homebase.schema.json");
  await mkdir(configDirectory, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await cp(path.join(repositoryRoot, "config/homebase.schema.json"), schemaFile);

  return {
    root,
    projectRoot,
    workspaceRoot,
    dataRoot,
    configFile,
    schemaFile,
    writeRegistry: async (registry) => {
      await writeFile(configFile, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
