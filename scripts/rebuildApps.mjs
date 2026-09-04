import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function computeInstallSignature(appPath) {
  const packageJsonPath = join(appPath, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;

  const hash = createHash("sha256");
  hash.update(readFileSync(packageJsonPath));
  const lockfilePath = join(appPath, "package-lock.json");
  if (existsSync(lockfilePath)) {
    hash.update(readFileSync(lockfilePath));
  }
  return hash.digest("hex");
}

function rebuildStampPath(appPath) {
  return join(appPath, "node_modules", ".homebase-rebuild-signature");
}

function readInstallStamp(appPath) {
  try {
    return readFileSync(rebuildStampPath(appPath), "utf-8").trim();
  } catch {
    return undefined;
  }
}

function writeInstallStamp(appPath, signature) {
  writeFileSync(rebuildStampPath(appPath), signature, "utf-8");
}

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

  const nodeModulesPath = join(appPath, "node_modules");
  const signature = mode === "dev" ? computeInstallSignature(appPath) : undefined;
  const skipInstall =
    mode === "dev" &&
    signature !== undefined &&
    existsSync(nodeModulesPath) &&
    readInstallStamp(appPath) === signature;

  if (skipInstall) {
    console.log(`[rebuildApps] Dependencies unchanged for ${application.id}; skipping npm install.`);
  } else {
    const installArgs = mode === "prod" ? ["ci"] : ["install"];
    console.log(`[rebuildApps] npm ${installArgs.join(" ")} for ${application.id} (${appPath})`);
    const install = spawnSync("npm", installArgs, { cwd: appPath, stdio: "inherit", shell: true });
    if (install.status !== 0) {
      console.error(`[rebuildApps] npm ${installArgs[0]} failed for ${application.id}`);
      results.push({ id: application.id, ok: false, reason: "install" });
      continue;
    }
    if (mode === "dev" && signature !== undefined) {
      writeInstallStamp(appPath, signature);
    }
  }

  const appPackage = JSON.parse(readFileSync(join(appPath, "package.json"), "utf-8"));
  const appScripts = appPackage.scripts ?? {};

  // Sibling repos split "build" into a frontend/general build and a
  // separate `build:host`, which compiles the actual adapter HomeBase loads
  // (adapterPath, e.g. dist/host/index.js) — plain `build` alone does not
  // produce it. Some apps (e.g. DevPlanner) also need `build:hosted` instead
  // of `build` so built asset URLs are prefixed for their HomeBase basePath
  // rather than assuming they're served from `/`.
  const generalBuildScript = appScripts["build:hosted"]
    ? "build:hosted"
    : appScripts["build"]
      ? "build"
      : undefined;

  let buildFailed = false;
  let builtSomething = false;

  if (generalBuildScript) {
    console.log(`[rebuildApps] npm run ${generalBuildScript} for ${application.id} (${appPath})`);
    const build = spawnSync("npm", ["run", generalBuildScript], {
      cwd: appPath,
      stdio: "inherit",
      shell: true,
    });
    if (build.status !== 0) {
      console.error(`[rebuildApps] npm run ${generalBuildScript} failed for ${application.id}`);
      buildFailed = true;
    } else {
      builtSomething = true;
    }
  } else {
    console.warn(`[rebuildApps] ${application.id} defines neither "build:hosted" nor "build"; skipping.`);
  }

  if (!buildFailed && appScripts["build:host"]) {
    console.log(`[rebuildApps] npm run build:host for ${application.id} (${appPath})`);
    const buildHost = spawnSync("npm", ["run", "build:host"], {
      cwd: appPath,
      stdio: "inherit",
      shell: true,
    });
    if (buildHost.status !== 0) {
      console.error(`[rebuildApps] npm run build:host failed for ${application.id}`);
      buildFailed = true;
    } else {
      builtSomething = true;
    }
  } else if (!buildFailed) {
    console.warn(`[rebuildApps] ${application.id} defines no "build:host" script; its hosted adapter was not rebuilt.`);
  }

  if (buildFailed) {
    results.push({ id: application.id, ok: false, reason: "build" });
    continue;
  }
  if (!builtSomething) {
    results.push({ id: application.id, ok: false, reason: "nothing-to-build" });
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
