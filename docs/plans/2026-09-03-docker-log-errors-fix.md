# Fix Docker log errors across hosted services

**Date:** 2026-09-03  
**Status:** Implemented  
**Scope:** MemoryApi, LMApi  

## Overview

The HomeBase Docker container orchestrates several sibling applications (MemoryApi, LMApi, DevPlanner, LMEval) as **in-process hosted adapters**. This architecture creates a mismatch: each app's code assumes `process.cwd()` points to its own repo root, but all hosted apps inherit HomeBase's `process.cwd()` (`/app`). This caused three categories of log errors during container startup.

## Issues Fixed

### 1. MemoryApi: Missing `allTags.json` file (ENOENT)

**Error:**
```
Error reading tags file: Error: ENOENT: no such file or directory, 
open '/app/src/samples/allTags.json'
```

**Root cause:** `MemoryApi/src/services/reviewMemoriesService.ts` computed a file path at module scope using `process.cwd()`:
```typescript
const TAGS_FILE = path.join(process.cwd(), 'src', 'samples', 'allTags.json');
```

When hosted inside HomeBase, `process.cwd()` is `/app` (HomeBase's WORKDIR), so the path became `/app/src/samples/allTags.json` instead of `/workspace/MemoryApi/src/samples/allTags.json`. The file exists in both places during COPY in the Dockerfile, but only accessible at the correct path relative to the MemoryApi repo.

**Solution:** Follow the existing pattern used for `SQLITE_DB_PATH` and `PROMPT_TEMPLATE_BASE_PATH`:

1. **`configService.ts`**: Added `TAGS_FILE_PATH` field to both the `ConfigValues` interface and the `Config` class with the default value computed from `process.cwd()`.
2. **`reviewMemoriesService.ts`**: Removed the module-level `TAGS_FILE` constant and replaced it with a read from `config.TAGS_FILE_PATH` inside `getAllTags()` method.
3. **`host/adapter.ts`**: Added `TAGS_FILE_PATH: join(options.repositoryRoot, 'src', 'samples', 'allTags.json')` to the `reconfigure({})` call, which overrides the config value when running hosted.

This ensures standalone mode (MemoryApi's own Docker container or `npm start`) uses the `process.cwd()` default, while hosted mode (inside HomeBase) uses the correct repo-relative path provided by HomeBase.

**Files changed:**
- `MemoryApi/src/services/configService.ts` — Added `TAGS_FILE_PATH` field
- `MemoryApi/src/services/reviewMemoriesService.ts` — Use `config.TAGS_FILE_PATH` instead of module-level constant
- `MemoryApi/src/host/adapter.ts` — Override path in hosted mode

### 2. LMApi: Ollama fetch timeout too aggressive

**Error:**
```
WARN: Error fetching running models from http://192.168.7.38:11434: 
This operation was aborted
```

**Root cause:** `LMApi/src/services/ModelCacheService.ts` has two methods (`getModels`, `getRunningModels`) that poll configured Ollama servers with a hardcoded 3-second `AbortController` timeout. The IP `192.168.7.38` is a real remote machine (M2 Max) in the servers config. A 3s timeout is too aggressive for a remote box that may be waking from sleep or under load.

**Solution:** Extracted the timeout into a class constant `FETCH_TIMEOUT_MS = 8000` (8 seconds) and used it in both methods. This gives remote machines more time to answer without aborting.

**Files changed:**
- `LMApi/src/services/ModelCacheService.ts` — Add `FETCH_TIMEOUT_MS` constant; use in both `getModels` and `getRunningModels`

**Note:** If the M2 Max machine (`192.168.7.38`) is intentionally offline or routinely unavailable, consider either:
- Removing it from `LMApi/src/config/servers.json`, or
- Treating the warning as environmental and downgrading to debug-level logs for known-intermittent hosts.

### 3. Config warnings (no fix needed)

**Error:**
```
[Config] WARNING: The following env variables were not provided. 
Using defaults: LLM_HOST, NEO4J_URI, ...
```

**Analysis:** The config service warns for every field in `ConfigValues` that isn't found in `process.env`. However, all fields have working built-in defaults (confirmed against `.env.example` and `HomeBase/.env.docker`). This is benign noise — defaults are sensible and sufficient.

**Decision:** No code change made. The warnings are expected and don't indicate a problem. Suppress in logs if desired by:
- Populating `.env.docker` with the currently-defaulted values so the warning list shrinks, or
- Downgrading the log level in `configService.ts` (line 136), though this is purely cosmetic.

### 4. Git data directory warning (no fix needed)

**Error:**
```
[git] data/ is not a git repository. Run POST /api/eval/git/init to initialize.
```

**Analysis:** Informational startup check from `LMEval/server/index.ts`. The shared `data/` directory stores evaluation logs and artifacts (not source), so it doesn't need to be a git repo. This is expected.

**Decision:** No fix needed. The message is informational and doesn't prevent startup.

## Testing

When restarting the Docker stack after rebuilding:

1. **MemoryApi fix:** Call the review-memories endpoint that invokes `getAllTags()` (wired in `reviewAPI.ts:96`) and confirm:
   - No `ENOENT '/app/src/samples/allTags.json'` in logs
   - Tags are returned successfully

2. **LMApi fix:** Watch the HomeBase dashboard logs during server status polling:
   - Confirm the `192.168.7.38:11434` warning no longer appears within the old 3s window
   - If the remote box is reachable, the 8s window should be enough; if still timing out, the box is offline/unreachable (environmental)

3. **Config warnings:** Confirm they remain (expected) or reduce if `.env.docker` is populated

## Architectural Note

The hosted-adapter pattern in HomeBase (`ApplicationHost.ts`) loads sibling apps via dynamic ESM `import()` into the same process. This means all hosted apps inherit HomeBase's runtime environment (`process.cwd()`, `process.env`, etc.). To work correctly, hosted apps must:

- Declare path-shaped config values as overridable `ConfigValues` fields, not as module-level constants
- Use the `reconfigure()` function in their adapter to override those values with repo-relative paths passed via `options.repositoryRoot`/`options.dataPath`

This pattern is already used successfully for `SQLITE_DB_PATH` and `PROMPT_TEMPLATE_BASE_PATH` in MemoryApi — the `TAGS_FILE_PATH` fix applies the same proven approach.
