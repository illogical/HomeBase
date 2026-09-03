import { readFile } from "node:fs/promises";
import path from "node:path";

export type PackageScriptsError = "no-package-json" | "invalid-package-json" | "read-error";

export interface PackageScriptsResult {
  readonly scripts: Readonly<Record<string, string>>;
  readonly checkedAt: string;
  readonly error?: PackageScriptsError;
}

export class PackageScriptsService {
  async getScripts(repositoryRoot: string): Promise<PackageScriptsResult> {
    const checkedAt = new Date().toISOString();
    let raw: string;
    try {
      raw = await readFile(path.join(repositoryRoot, "package.json"), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { scripts: {}, checkedAt, error: "no-package-json" };
      }
      return { scripts: {}, checkedAt, error: "read-error" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { scripts: {}, checkedAt, error: "invalid-package-json" };
    }

    const scripts = extractScripts(parsed);
    if (scripts === null) {
      return { scripts: {}, checkedAt, error: "invalid-package-json" };
    }
    return { scripts, checkedAt };
  }
}

function extractScripts(parsed: unknown): Readonly<Record<string, string>> | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const scripts = (parsed as Record<string, unknown>).scripts;
  if (scripts === undefined) {
    return {};
  }
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") {
      return null;
    }
    result[name] = command;
  }
  return result;
}
