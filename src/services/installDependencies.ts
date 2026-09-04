import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationConfiguration } from "../config/models.js";
import type { ApplicationLogger } from "../contracts/hostedApplication.js";

export type InstallDependenciesFn = (
  application: ApplicationConfiguration,
  logger: ApplicationLogger,
  signal?: AbortSignal,
) => Promise<void>;

interface InstallStamp {
  readonly signature: string;
  readonly installedAt: string;
}

function stampPath(application: ApplicationConfiguration): string {
  return join(application.dataPath, "install-stamp.json");
}

async function computeSignature(repositoryRoot: string): Promise<string | undefined> {
  const packageJsonPath = join(repositoryRoot, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;

  const hash = createHash("sha256");
  hash.update(await readFile(packageJsonPath));
  const lockfilePath = join(repositoryRoot, "package-lock.json");
  if (existsSync(lockfilePath)) {
    hash.update(await readFile(lockfilePath));
  }
  return hash.digest("hex");
}

async function readStamp(application: ApplicationConfiguration): Promise<InstallStamp | undefined> {
  try {
    const raw = JSON.parse(await readFile(stampPath(application), "utf-8")) as Partial<InstallStamp>;
    return typeof raw.signature === "string" ? { signature: raw.signature, installedAt: String(raw.installedAt) } : undefined;
  } catch {
    return undefined;
  }
}

async function writeStamp(application: ApplicationConfiguration, signature: string): Promise<void> {
  await mkdir(application.dataPath, { recursive: true });
  const stamp: InstallStamp = { signature, installedAt: new Date().toISOString() };
  await writeFile(stampPath(application), JSON.stringify(stamp), "utf-8");
}

function runNpmInstall(repositoryRoot: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Deliberately no --no-package-lock: that flag makes npm ignore the
    // existing lockfile and fully re-resolve the dependency tree from the
    // registry on every call, which is what made this time out. Plain
    // `npm install` respects the existing lockfile/node_modules and only
    // does the incremental work actually needed. If the lockfile really is
    // stale, npm will rewrite it here — that's an accurate signal, not a bug.
    //
    // `detached` puts the shell in its own process group on POSIX so an
    // abort can kill the whole group (shell + real npm process it spawns),
    // not just the shell — without this, a timed-out install kept running
    // orphaned in the background, competing for CPU/IO with every later
    // attempt and making subsequent installs time out too.
    const child = spawn("npm", ["install"], {
      cwd: repositoryRoot,
      stdio: "ignore",
      shell: true,
      detached: process.platform !== "win32",
    });

    const onAbort = (): void => {
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        child.kill();
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", reject);
    child.once("exit", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
  });
}

export const installDependencies: InstallDependenciesFn = async (application, logger, signal) => {
  if (!existsSync(application.repositoryRoot)) {
    logger.log(
      "warn",
      "install-skipped",
      `Sibling application path does not exist: ${application.repositoryRoot}`,
    );
    return;
  }

  const signature = await computeSignature(application.repositoryRoot);
  const nodeModulesPath = join(application.repositoryRoot, "node_modules");
  if (signature !== undefined && existsSync(nodeModulesPath)) {
    const stamp = await readStamp(application);
    if (stamp?.signature === signature) {
      logger.log(
        "info",
        "install-skipped-unchanged",
        "Dependencies already installed and unchanged; skipping npm install.",
      );
      return;
    }
  }

  await runNpmInstall(application.repositoryRoot, signal);

  if (signature !== undefined) {
    await writeStamp(application, signature);
  }
};
