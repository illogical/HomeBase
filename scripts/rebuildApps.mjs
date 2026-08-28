import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const mode = args.includes("--mode")
  ? args[args.indexOf("--mode") + 1]
  : "dev";
if (mode !== "dev" && mode !== "prod") {
  console.error(`[rebuildApps] Invalid --mode "${mode}"; expected "dev" or "prod".`);
  process.exit(1);
}
const onlyAppId = args.includes("--app") ? args[args.indexOf("--app") + 1] : undefined;
const skipRestart = args.includes("--no-restart");

const configPath = fileURLToPath(new URL("../config/homebase.json", import.meta.url));
const workspaceRoot = process.env.HOMEBASE_WORKSPACE_PATH;
if (!workspaceRoot) {
  console.error("[rebuildApps] HOMEBASE_WORKSPACE_PATH is not set (check .env).");
  process.exit(1);
}

const { applications } = JSON.parse(readFileSync(configPath, "utf-8"));

const targets = applications.filter((application) => {
  if (!application.enabled) return false;
  if (onlyAppId && application.id !== onlyAppId) return false;
  return true;
});

if (onlyAppId && targets.length === 0) {
  console.error(`[rebuildApps] No enabled application with id "${onlyAppId}" found.`);
  process.exit(1);
}

const results = [];

for (const application of targets) {
  const appPath = join(workspaceRoot, application.repoPath);
  if (!existsSync(appPath)) {
    console.warn(`[rebuildApps] Skipping ${application.id}: ${appPath} does not exist`);
    results.push({ id: application.id, ok: false, reason: "missing" });
    continue;
  }

  const installArgs = mode === "prod" ? ["ci"] : ["install", "--no-package-lock"];
  console.log(`[rebuildApps] npm ${installArgs.join(" ")} for ${application.id} (${appPath})`);
  const install = spawnSync("npm", installArgs, { cwd: appPath, stdio: "inherit", shell: true });
  if (install.status !== 0) {
    console.error(`[rebuildApps] npm ${installArgs[0]} failed for ${application.id}`);
    results.push({ id: application.id, ok: false, reason: "install" });
    continue;
  }

  console.log(`[rebuildApps] npm run build for ${application.id} (${appPath})`);
  const build = spawnSync("npm", ["run", "build"], { cwd: appPath, stdio: "inherit", shell: true });
  if (build.status !== 0) {
    console.error(`[rebuildApps] npm run build failed for ${application.id}`);
    results.push({ id: application.id, ok: false, reason: "build" });
    continue;
  }

  results.push({ id: application.id, ok: true });
}

console.log("\n[rebuildApps] Summary:");
for (const result of results) {
  console.log(`  ${result.ok ? "OK  " : "FAIL"} ${result.id}${result.reason ? ` (${result.reason})` : ""}`);
}

const anyFailed = results.some((result) => !result.ok);
const anyBuilt = results.some((result) => result.ok);

if (mode === "dev" && anyBuilt && !skipRestart) {
  console.log("\n[rebuildApps] Restarting homebase-dev so the rebuilt adapters load...");
  const restart = spawnSync(
    "docker",
    ["compose", "--env-file", ".env.docker", "-f", "docker-compose.dev.yml", "restart", "homebase-dev"],
    { stdio: "inherit", shell: true },
  );
  if (restart.status !== 0) {
    console.warn(
      "[rebuildApps] Could not restart homebase-dev (is the dev container running?). " +
        "The rebuilt adapters are on disk but won't load until HomeBase restarts.",
    );
  }
}

process.exit(anyFailed ? 1 : 0);
