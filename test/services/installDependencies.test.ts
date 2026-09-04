import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationConfiguration } from "../../src/config/models.js";
import { createTestLogger } from "../support/testLogger.js";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function fakeSuccessfulChild(): EventEmitter {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit("exit", 0));
  return child;
}

function fixtureApplication(repositoryRoot: string, dataPath: string): ApplicationConfiguration {
  return {
    id: "fixture-app",
    displayName: "Fixture App",
    description: "Fixture application under test.",
    slug: "fixture-app",
    basePath: "/fixture-app/",
    enabled: true,
    repoPath: "fixture-app",
    repositoryRoot,
    adapterPath: "index.ts",
    adapterFile: path.join(repositoryRoot, "index.ts"),
    contractVersion: 1,
    defaultBranch: undefined,
    packageManager: undefined,
    devCommands: [],
    tags: [],
    icon: undefined,
    category: undefined,
    sortOrder: undefined,
    dataPath,
    adapterConfig: undefined,
    startupIssue: undefined,
  };
}

describe("installDependencies", () => {
  let root: string;
  let repositoryRoot: string;
  let dataPath: string;

  beforeEach(async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeSuccessfulChild());
    root = await mkdtemp(path.join(os.tmpdir(), "homebase-install-"));
    repositoryRoot = path.join(root, "repo");
    dataPath = path.join(root, "data");
    await mkdir(repositoryRoot, { recursive: true });
    await mkdir(dataPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs npm install (without --no-package-lock) when there is no prior stamp", async () => {
    await writeFile(path.join(repositoryRoot, "package.json"), JSON.stringify({ name: "fixture" }), "utf8");
    const { installDependencies } = await import("../../src/services/installDependencies.js");
    const application = fixtureApplication(repositoryRoot, dataPath);

    await installDependencies(application, createTestLogger());

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnMock.mock.calls[0]!;
    expect(command).toBe("npm");
    expect(args).toEqual(["install"]);

    const stamp = JSON.parse(await readFile(path.join(dataPath, "install-stamp.json"), "utf8"));
    expect(typeof stamp.signature).toBe("string");
    expect(typeof stamp.installedAt).toBe("string");
  });

  it("skips npm install when package.json/lockfile are unchanged and node_modules already exists", async () => {
    await writeFile(path.join(repositoryRoot, "package.json"), JSON.stringify({ name: "fixture" }), "utf8");
    await mkdir(path.join(repositoryRoot, "node_modules"), { recursive: true });
    const { installDependencies } = await import("../../src/services/installDependencies.js");
    const application = fixtureApplication(repositoryRoot, dataPath);

    await installDependencies(application, createTestLogger());
    expect(spawnMock).toHaveBeenCalledTimes(1);

    spawnMock.mockClear();
    await installDependencies(application, createTestLogger());

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("re-installs after package.json changes even if node_modules already exists", async () => {
    const packageJsonPath = path.join(repositoryRoot, "package.json");
    await writeFile(packageJsonPath, JSON.stringify({ name: "fixture", version: "1.0.0" }), "utf8");
    await mkdir(path.join(repositoryRoot, "node_modules"), { recursive: true });
    const { installDependencies } = await import("../../src/services/installDependencies.js");
    const application = fixtureApplication(repositoryRoot, dataPath);

    await installDependencies(application, createTestLogger());
    expect(spawnMock).toHaveBeenCalledTimes(1);

    await writeFile(packageJsonPath, JSON.stringify({ name: "fixture", version: "1.0.1" }), "utf8");
    spawnMock.mockClear();
    await installDependencies(application, createTestLogger());

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("does not write a stamp when the install fails, so the next attempt retries for real", async () => {
    await writeFile(path.join(repositoryRoot, "package.json"), JSON.stringify({ name: "fixture" }), "utf8");
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 1));
      return child;
    });
    const { installDependencies } = await import("../../src/services/installDependencies.js");
    const application = fixtureApplication(repositoryRoot, dataPath);

    await expect(installDependencies(application, createTestLogger())).rejects.toThrow();

    await expect(readFile(path.join(dataPath, "install-stamp.json"), "utf8")).rejects.toThrow();

    await installDependencies(application, createTestLogger());
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the repository path does not exist", async () => {
    const { installDependencies } = await import("../../src/services/installDependencies.js");
    const application = fixtureApplication(path.join(root, "missing"), dataPath);

    await installDependencies(application, createTestLogger());

    expect(spawnMock).not.toHaveBeenCalled();
  });
});
