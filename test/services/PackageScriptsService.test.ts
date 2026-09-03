import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageScriptsService } from "../../src/services/PackageScriptsService.js";

describe("PackageScriptsService", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "package-scripts-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns no-package-json when the repository has none", async () => {
    const service = new PackageScriptsService();
    const result = await service.getScripts(root);
    expect(result.error).toBe("no-package-json");
    expect(result.scripts).toEqual({});
  });

  it("returns invalid-package-json for malformed JSON", async () => {
    await writeFile(path.join(root, "package.json"), "{ not json", "utf8");
    const service = new PackageScriptsService();
    const result = await service.getScripts(root);
    expect(result.error).toBe("invalid-package-json");
  });

  it("returns invalid-package-json when scripts is not a string map", async () => {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { build: 5 } }),
      "utf8",
    );
    const service = new PackageScriptsService();
    const result = await service.getScripts(root);
    expect(result.error).toBe("invalid-package-json");
  });

  it("returns the scripts map for a valid package.json", async () => {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", dev: "vite dev" } }),
      "utf8",
    );
    const service = new PackageScriptsService();
    const result = await service.getScripts(root);
    expect(result.error).toBeUndefined();
    expect(result.scripts).toEqual({ build: "tsc", dev: "vite dev" });
  });

  it("returns an empty scripts map when package.json has no scripts field", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "x" }), "utf8");
    const service = new PackageScriptsService();
    const result = await service.getScripts(root);
    expect(result.error).toBeUndefined();
    expect(result.scripts).toEqual({});
  });

  it("returns read-error when the path is not readable as a file", async () => {
    await mkdir(path.join(root, "package.json"));
    const service = new PackageScriptsService();
    const result = await service.getScripts(root);
    expect(result.error).toBe("read-error");
  });
});
