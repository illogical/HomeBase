import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ApplicationHost } from "../../src/services/ApplicationHost.js";
import { ConfigService } from "../../src/services/ConfigService.js";
import { createTestLogger } from "../support/testLogger.js";
import { createConfigFixture, validRegistry } from "../support/configFixture.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

async function initRepoWithCommit(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(dir, ["init", "--quiet"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(dir, "a.txt"), "hello", "utf8");
  await git(dir, ["add", "a.txt"]);
  await git(dir, ["commit", "--quiet", "-m", "initial"]);
}

async function buildApp(
  fixture: Awaited<ReturnType<typeof createConfigFixture>>,
): Promise<ReturnType<typeof createApp>["app"]> {
  const configService = await ConfigService.load({
    projectRoot: fixture.projectRoot,
    environment: {
      HOMEBASE_WORKSPACE_PATH: fixture.workspaceRoot,
      HOMEBASE_DATA_PATH: fixture.dataRoot,
    },
    nodeVersion: "24.0.0",
  });
  const applicationHost = await ApplicationHost.loadAll(configService, createTestLogger());
  return createApp(configService, applicationHost).app;
}

describe("/api/homebase git status routes", () => {
  it("returns 404 for an unknown application id", async () => {
    const fixture = await createConfigFixture();
    try {
      await fixture.writeRegistry(validRegistry());
      const app = await buildApp(fixture);

      const response = await request(app).get("/api/homebase/applications/does-not-exist/git-status");

      expect(response.status).toBe(404);
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns clean-repo status for a configured application", async () => {
    const fixture = await createConfigFixture();
    try {
      const registry = validRegistry();
      await fixture.writeRegistry(registry);
      await initRepoWithCommit(path.join(fixture.workspaceRoot, "FirstApp"));
      const app = await buildApp(fixture);

      const response = await request(app).get("/api/homebase/applications/first-app/git-status");

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.workingTree).toBe("clean");
      expect(response.body.error).toBe("no-upstream");
    } finally {
      await fixture.cleanup();
    }
  });

  it("runs a real fetch against a configured application", async () => {
    const fixture = await createConfigFixture();
    try {
      const registry = validRegistry();
      await fixture.writeRegistry(registry);
      await initRepoWithCommit(path.join(fixture.workspaceRoot, "FirstApp"));
      const app = await buildApp(fixture);

      const response = await request(app).post("/api/homebase/applications/first-app/git-status/fetch");

      expect(response.status).toBe(200);
      expect(response.body.workingTree).toBe("clean");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a pull against a dirty working tree with 409", async () => {
    const fixture = await createConfigFixture();
    try {
      const registry = validRegistry();
      await fixture.writeRegistry(registry);
      const repoDir = path.join(fixture.workspaceRoot, "FirstApp");
      await initRepoWithCommit(repoDir);
      await writeFile(path.join(repoDir, "a.txt"), "changed", "utf8");
      const app = await buildApp(fixture);

      const response = await request(app).post("/api/homebase/applications/first-app/git-status/pull");

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("dirty-tree");
      expect(response.body.pulled).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects an overlapping request for the same application with 409", async () => {
    const fixture = await createConfigFixture();
    try {
      const registry = validRegistry();
      await fixture.writeRegistry(registry);
      await initRepoWithCommit(path.join(fixture.workspaceRoot, "FirstApp"));
      const app = await buildApp(fixture);

      const [first, second] = await Promise.all([
        request(app).post("/api/homebase/applications/first-app/git-status/fetch"),
        request(app).post("/api/homebase/applications/first-app/git-status/fetch"),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
    } finally {
      await fixture.cleanup();
    }
  });
});
