import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitStatusService } from "../../src/services/GitStatusService.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

async function initRepo(root: string, name: string): Promise<string> {
  const dir = path.join(root, name);
  await execFileAsync("git", ["init", "--quiet", dir], { windowsHide: true });
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

async function commitFile(dir: string, fileName: string, content: string, message: string): Promise<void> {
  await writeFile(path.join(dir, fileName), content, "utf8");
  await git(dir, ["add", fileName]);
  await git(dir, ["commit", "--quiet", "-m", message]);
}

describe("GitStatusService", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "homebase-git-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports a non-git directory as not-a-git-repository", async () => {
    const service = new GitStatusService();
    const status = await service.getStatus("app", root);
    expect(status.error).toBe("not-a-git-repository");
  });

  it("reports a clean repository with no upstream", async () => {
    const dir = await initRepo(root, "clean-repo");
    await commitFile(dir, "a.txt", "hello", "initial");

    const service = new GitStatusService();
    const status = await service.getStatus("app", dir);

    expect(status.workingTree).toBe("clean");
    expect(status.branch).not.toBeNull();
    expect(status.commit).not.toBeNull();
    expect(status.error).toBe("no-upstream");
    expect(status.upstream).toBeNull();
  });

  it("reports a dirty working tree", async () => {
    const dir = await initRepo(root, "dirty-repo");
    await commitFile(dir, "a.txt", "hello", "initial");
    await writeFile(path.join(dir, "a.txt"), "changed", "utf8");

    const service = new GitStatusService();
    const status = await service.getStatus("app", dir);

    expect(status.workingTree).toBe("dirty");
  });

  it("reports detached HEAD", async () => {
    const dir = await initRepo(root, "detached-repo");
    await commitFile(dir, "a.txt", "hello", "initial");
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir, windowsHide: true });
    await git(dir, ["checkout", "--quiet", stdout.trim()]);

    const service = new GitStatusService();
    const status = await service.getStatus("app", dir);

    expect(status.branch).toBeNull();
    expect(status.error).toBe("detached-head");
  });

  it("reports ahead/behind counts relative to upstream", async () => {
    const bare = path.join(root, "upstream.git");
    await execFileAsync("git", ["init", "--quiet", "--bare", bare], { windowsHide: true });

    const origin = await initRepo(root, "origin-clone");
    await git(origin, ["remote", "add", "origin", bare]);
    await commitFile(origin, "a.txt", "one", "commit 1");
    await git(origin, ["push", "--quiet", "-u", "origin", "HEAD:main"]);

    const clone = path.join(root, "clone");
    await execFileAsync("git", ["clone", "--quiet", bare, clone], { windowsHide: true });
    await git(clone, ["config", "user.email", "test@example.com"]);
    await git(clone, ["config", "user.name", "Test"]);
    await git(clone, ["checkout", "--quiet", "-B", "main", "origin/main"]);
    await git(clone, ["branch", "--set-upstream-to=origin/main", "main"]);

    // Advance origin ahead of the clone by one commit, pushed upstream.
    await commitFile(origin, "b.txt", "two", "commit 2");
    await git(origin, ["push", "--quiet", "origin", "HEAD:main"]);
    await git(clone, ["fetch", "--quiet"]);

    // Advance the clone ahead locally by one commit, not yet pushed.
    await commitFile(clone, "c.txt", "three", "local commit");

    const service = new GitStatusService();
    const status = await service.getStatus("app", clone);

    expect(status.upstream).toBe("origin/main");
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(1);
    expect(status.error).toBeUndefined();
  });

  it("fetch updates behind count and pull fast-forwards a clean clone", async () => {
    const bare = path.join(root, "upstream2.git");
    await execFileAsync("git", ["init", "--quiet", "--bare", bare], { windowsHide: true });

    const origin = await initRepo(root, "origin2");
    await git(origin, ["remote", "add", "origin", bare]);
    await commitFile(origin, "a.txt", "one", "commit 1");
    await git(origin, ["push", "--quiet", "-u", "origin", "HEAD:main"]);

    const clone = path.join(root, "clone2");
    await execFileAsync("git", ["clone", "--quiet", bare, clone], { windowsHide: true });
    await git(clone, ["config", "user.email", "test@example.com"]);
    await git(clone, ["config", "user.name", "Test"]);
    await git(clone, ["checkout", "--quiet", "-B", "main", "origin/main"]);
    await git(clone, ["branch", "--set-upstream-to=origin/main", "main"]);

    await commitFile(origin, "b.txt", "two", "commit 2");
    await git(origin, ["push", "--quiet", "origin", "HEAD:main"]);

    const service = new GitStatusService();

    const beforeFetch = await service.getStatus("app", clone);
    expect(beforeFetch.behind).toBe(0);

    const fetchResult = await service.fetch("app", clone);
    if ("conflict" in fetchResult) throw new Error("unexpected conflict");
    expect(fetchResult.behind).toBe(1);

    const pullResult = await service.pull("app", clone);
    if ("conflict" in pullResult) throw new Error("unexpected conflict");
    expect(pullResult.pulled).toBe(true);
    expect(pullResult.behind).toBe(0);
  });

  it("refuses to pull a dirty tree", async () => {
    const bare = path.join(root, "upstream3.git");
    await execFileAsync("git", ["init", "--quiet", "--bare", bare], { windowsHide: true });

    const origin = await initRepo(root, "origin3");
    await git(origin, ["remote", "add", "origin", bare]);
    await commitFile(origin, "a.txt", "one", "commit 1");
    await git(origin, ["push", "--quiet", "-u", "origin", "HEAD:main"]);

    const clone = path.join(root, "clone3");
    await execFileAsync("git", ["clone", "--quiet", bare, clone], { windowsHide: true });
    await git(clone, ["config", "user.email", "test@example.com"]);
    await git(clone, ["config", "user.name", "Test"]);
    await git(clone, ["checkout", "--quiet", "-B", "main", "origin/main"]);
    await git(clone, ["branch", "--set-upstream-to=origin/main", "main"]);
    await writeFile(path.join(clone, "a.txt"), "dirty change", "utf8");

    const service = new GitStatusService();
    const pullResult = await service.pull("app", clone);
    if ("conflict" in pullResult) throw new Error("unexpected conflict");
    expect(pullResult.pulled).toBe(false);
    expect(pullResult.error).toBe("dirty-tree");
  });
});
