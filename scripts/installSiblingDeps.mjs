import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const configPath = fileURLToPath(new URL("../config/homebase.json", import.meta.url));
const workspaceRoot = process.env.HOMEBASE_WORKSPACE_PATH ?? "/workspace";

const { applications } = JSON.parse(readFileSync(configPath, "utf-8"));

for (const application of applications) {
  if (!application.enabled) continue;

  const appPath = join(workspaceRoot, application.repoPath);
  if (!existsSync(appPath)) {
    console.warn(`[installSiblingDeps] Skipping ${application.id}: ${appPath} does not exist`);
    continue;
  }

  console.log(`[installSiblingDeps] npm install for ${application.id} (${appPath})`);
  const result = spawnSync("npm", ["install", "--no-package-lock"], {
    cwd: appPath,
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`[installSiblingDeps] npm install failed for ${application.id}`);
    process.exit(result.status ?? 1);
  }
}
