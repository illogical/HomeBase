# Handoff: sibling-install caching/retry — Docker still failing after implementation

**Status:** Implemented on the host / passing all local tests. **Still failing in the Docker dev container** — needs a fresh session to continue troubleshooting the Docker-specific failure.

## What this covers

Two related pieces of work, both already implemented and committed to the working tree (not yet git-committed as a commit — see `git status` below):

1. [`2026-09-03-sibling-install-caching-and-retry.md`](2026-09-03-sibling-install-caching-and-retry.md) — the plan for this session's main work: fix the `npm install --no-package-lock` timeout root cause, add a content-hash skip-cache, add a per-app retry endpoint/button.
2. A non-blocking-startup change from earlier in this session (no separate plan file — implemented directly): `ApplicationHost.loadAll()` no longer blocks the HTTP server on every sibling app finishing load; each app loads in the background and the dashboard shows live `loading`/`initializing` states via polling.
3. [`2026-09-03-docker-log-errors-fix.md`](2026-09-03-docker-log-errors-fix.md) is **unrelated** prior work (MemoryApi/LMApi `process.cwd()` fixes) — it was open in the IDE but is a different, already-completed task. Ignore it for this handoff.

## What was actually changed (uncommitted working tree)

Per `git status` at handoff time:

```
M  Dockerfile
M  README.md
MM dashboard/src/App.test.tsx
 M dashboard/src/App.tsx
 M dashboard/src/GitStatusPanel.test.tsx
 M dashboard/src/fixtures.ts
 M dashboard/src/httpDataSource.ts
 M dashboard/src/models.ts
M  dashboard/src/styles.css
M  dashboard/src/useApplications.ts
A  docs/plans/2026-09-03-docker-log-errors-fix.md          (unrelated, pre-existing)
A  docs/plans/2026-09-03-sibling-install-caching-and-retry.md
D  scripts/installSiblingDeps.mjs
 M src/routes/applications.ts
MM src/services/ApplicationHost.ts
AM src/services/installDependencies.ts
A  test/fixtures/adapters/slow-initialize/index.ts
M  test/integration/hostedApplications.test.ts
MM test/routes/applications.test.ts
MM test/services/ApplicationHost.test.ts
M  test/support/fixtureAdapters.ts
?? test/services/installDependencies.test.ts
```

**Nothing has been committed.** All of this is working-tree state.

### ⚠️ Files that changed on disk outside this session, after I last touched them

`dashboard/src/App.tsx` and `dashboard/src/App.test.tsx` were edited again after my own edits landed — the wording changed (e.g. "No sample applications" → "No applications", "{n} sample applications" → "{n} applications", "Sample applications could not be loaded" → "Applications could not be loaded"). I did not make these changes and did not revert them. **Confirm with the user or `git diff` what these are before assuming they're mine** — they look like a deliberate copy cleanup, possibly done by hand or by another session/process while this one was running.

### Backend

- **`src/services/installDependencies.ts`** (rewritten): computes a SHA-256 signature over `package.json` + `package-lock.json` under `application.repositoryRoot`; compares to a stamp file at `<application.dataPath>/install-stamp.json`; skips `npm install` entirely if the signature matches an existing stamp **and** `node_modules` exists. Otherwise runs plain `npm install` (dropped `--no-package-lock`, which was the original timeout root cause — it forces a full re-resolve every time). Writes the stamp only on success.
- **`src/services/ApplicationHost.ts`**:
  - `loadAll()` is now non-blocking: builds initial records, returns the host immediately, loads every app's install→import→initialize pipeline in the background (`#loadOne`), mutating each record in place.
  - Added `retry(id): boolean` — resets an `"unavailable"` record to `"loading"` and re-runs `#loadOne` for just that app; no-ops (`false`) for anything not currently `"unavailable"`.
  - `#hostOrigin`/`#installDeps` are now instance fields (set once in the constructor) so `retry()` can reuse the same pipeline as initial boot.
  - `mountApplication()` routing is now dynamic (checks live `record.state`/`instance` per request) instead of baked in at mount time — needed once loading became async.
- **`src/routes/applications.ts`**: added `POST /applications/:id/retry` → `202` + current status on success, `409` if the app isn't currently `"unavailable"`.
- **`Dockerfile`**: dropped the old blocking `node scripts/installSiblingDeps.mjs && ...` prefix from the dev `CMD` (install now happens per-app, in the background, inside `ApplicationHost`). `scripts/installSiblingDeps.mjs` deleted — its logic moved into `installDependencies.ts`.

### Frontend

- **`dashboard/src/useApplications.ts`**: polls `GET /api/applications` every ~2s while any app is `loading`/`initializing`, stops once all are terminal.
- **`dashboard/src/App.tsx`**: added a visible "Retry" button on any `"unavailable"` card (calls `dataSource.retryApplication(id)` then re-triggers polling).
- **`dashboard/src/httpDataSource.ts`** / **`dashboard/src/models.ts`** / **`dashboard/src/fixtures.ts`**: added `retryApplication()` to the `DashboardDataSource` interface, its HTTP implementation, and a fixture simulation (flips an app from `unavailable` → `loading` → `ready` after 800ms) for the `"mixed"` fixture scenario.
- **`dashboard/src/styles.css`**: reused the existing `skeleton-pulse` keyframes on `.status-dot` for `loading`/`initializing` cards.

### Tests

New/updated: `test/services/installDependencies.test.ts` (new, 5 tests — skip/re-install/failure-no-stamp logic, mocks `node:child_process.spawn`), `test/services/ApplicationHost.test.ts` (+`retry()` tests, +non-blocking-load tests), `test/routes/applications.test.ts` (+retry route tests), `test/integration/hostedApplications.test.ts`, `dashboard/src/App.test.tsx` (+retry-button test, +polling test), `dashboard/src/fixtures.ts`/`GitStatusPanel.test.tsx` (interface compliance).

**Test status as of handoff:** `npx tsc --noEmit` and `npx tsc --noEmit -p tsconfig.client.json` both clean. `npx vitest run --exclude "**/.claude/**"` → 188 passed, 2 failed, 2 skipped. **The 2 failures are pre-existing and unrelated** — an accessibility violation (`link-name`) on the DevPlanner card's monogram link in `dashboard/src/App.test.tsx` — confirmed by stashing `App.tsx`/`App.test.tsx` back to the committed baseline and re-running; it fails there too. Not something this session introduced or should try to fix.

**Note:** there is a stray nested git worktree at `.claude/worktrees/agent-abccfa4a0408d4dbe/` (unrelated leftover from a different agent run, untouched, not part of this work) that duplicates test file paths — always pass `--exclude "**/.claude/**"` to vitest or it double-runs against stale copies and gives confusing failures.

## Current symptom (why this needs a fresh session)

User: locally (`npm run dev`, non-Docker), the fix worked as expected. **After recreating the Docker dev container, all four sibling apps immediately show `"Unavailable"`.**

## Evidence already gathered (don't need to re-collect this)

- `data/homebase/log/homebase.ndjson` (only 12 lines total, stops updating at `2026-09-04T00:17:50Z` despite the container running much longer — flush behavior on restart may be lossy, worth checking) shows, across three separate process instances:
  1. `2026-09-04T00:01:49Z` — the original pre-fix symptom: `TimeoutError: installDependencies timed out after 120000ms` for all four apps (this is what the whole fix was for).
  2. `2026-09-04T00:15:25Z` — a **new** error on one process instance: `TypeError: installDeps is not a function` at `ApplicationHost.ts:333` (inside `#loadOne`, calling `this.#installDeps(...)`). Only seen once, on one instance.
  3. `2026-09-04T00:17:50Z` — the **current** running process (confirmed via `docker compose ps` — container created `2026-09-03 23:59:42 EDT`, still running/healthy) — back to `TimeoutError: installDependencies timed out after 120000ms` for all four apps.
- Confirmed via `docker compose --env-file .env.docker -f docker-compose.dev.yml exec homebase-dev`: the bind-mounted source files inside the container **do** contain the final code (`grep -c retry src/services/ApplicationHost.ts` → 2, `grep -c install-skipped-unchanged src/services/installDependencies.ts` → 1) — so the file content is current.
- **But** `docker compose logs --timestamps homebase-dev | grep restarting` shows nodemon's last restart was at `00:15:49Z` — over 13 minutes before this file-content check, and well before several more `src/**` edits were made in this session afterward. **nodemon's `--legacy-watch` polling appears to have stopped detecting further file changes partway through the session**, so the currently-running Node process is almost certainly older than the code now on disk (though it does postdate the `installDependencies.ts` rewrite, since that shows up in the `TimeoutError` behavior rather than the old `--no-package-lock` behavior).
- Checked sibling apps' `node_modules` volumes inside the container (`docker-compose.dev.yml` gives each one its own **named Docker volume** — `devplanner-node-modules`, `lmapi-node-modules`, `memoryapi-node-modules`, `lmeval-node-modules` — separate from the Windows-host bind mount, which is deliberate and correct, avoiding a Windows/Linux native-module mismatch): `ls | wc -l` inside each shows non-trivial content (203/242/405/718 entries) — **not empty**, so this isn't a from-scratch-empty-volume install. Whether it's a *complete* `node_modules` (vs. partially installed / stale) wasn't checked.

## Leading hypotheses (unconfirmed — this is where the fresh session should start)

1. **nodemon stopped watching.** The container may simply need a restart (`docker compose --env-file .env.docker -f docker-compose.dev.yml restart homebase-dev`, or a full `down`/`up -d --build` to be safe) to pick up the complete final code and get a clean read on whether the fix actually works in Docker. This should be tried **first** — everything else may be moot until this is ruled out.
2. **Timeout still too tight for Docker.** `INSTALL_TIMEOUT_MS` in `src/services/ApplicationHost.ts` (currently 120,000ms) was sized against local/host `npm install` speed. All four apps' installs run **concurrently** (`loadAll()` fires every `#loadOne()` without awaiting), so under Docker Desktop's I/O/network characteristics, four concurrent `npm install` calls competing for the same VM's resources could plausibly still exceed 120s each, even with valid lockfiles/existing `node_modules` — this needs the actual per-app timing, not just "it timed out."
3. **The skip-cache may not be engaging in Docker.** The stamp file lives at `<application.dataPath>/install-stamp.json`, and `HOMEBASE_DATA_PATH` is bind-mounted (`${HOMEBASE_HOST_DATA_PATH}:/data:rw` in `docker-compose.dev.yml`) — check whether `HOMEBASE_HOST_DATA_PATH` in `.env.docker` points at the same `data/` directory used by local non-Docker runs. If so, a stamp written by a Windows-native `npm run dev` run could exist even though the container's `node_modules` (in its own named volume) never actually got a real install — worth confirming the signature-match still correctly falls through to a real install in that case (the code does check `existsSync(nodeModulesPath)` before trusting a stamp, so this *should* be handled, but verify against the actual mounted paths).
4. **The one-off `TypeError: installDeps is not a function`** at `00:15:25Z` was most likely a transient nodemon-mid-edit artifact (nodemon restarting while a file was only partially written through the Docker Desktop file-sharing layer) rather than a real code defect — the constructor wiring (`this.#installDeps = installDeps` in `ApplicationHost`'s constructor, set from `options.installDependencies ?? defaultInstallDependencies` in `loadAll()`) looks correct on inspection, `installDependencies.ts` exports the function correctly, and `test/services/installDependencies.test.ts` exercises it directly and passes. Worth a note but probably not the primary bug — confirm it doesn't recur after a clean restart per (1).

## Suggested next steps, in order

1. `docker compose --env-file .env.docker -f docker-compose.dev.yml down` then `up -d --build` for a truly clean state (rules out both stale-nodemon-watch and stale-image concerns at once).
2. Watch it start cold: `docker compose --env-file .env.docker -f docker-compose.dev.yml logs -f homebase-dev` and let a full install cycle complete or fail without interrupting it (don't edit any `src/**` files mid-watch, to avoid re-triggering the same nodemon-restart confusion).
3. If it still fails, get the precise error from `data/homebase/log/homebase.ndjson` for the new run's `serviceInstanceId`, and time how long each app's install actually took/ran before failing (add temporary timing logs if needed) to distinguish hypothesis 2 (genuinely too slow) from something else.
4. If it's a genuine timeout, consider raising `INSTALL_TIMEOUT_MS` in `src/services/ApplicationHost.ts:22` for now, and/or check whether serializing installs (instead of running all four concurrently) reduces contention enough to matter — that would be a small change to `loadAll()`'s dispatch loop.
5. Once one app loads successfully, the new Retry button / `POST /api/applications/:id/retry` endpoint can be used to re-attempt the others individually without restarting the whole container — useful for isolating whether the problem is per-app or systemic.

## Resolved (2026-09-03, follow-up session)

Root cause: `withTimeout` in `src/services/ApplicationHost.ts` never cancelled
the losing side of its `Promise.race` on timeout, and `runNpmInstall` in
`src/services/installDependencies.ts` only resolved/rejected on the spawned
`npm install` child's own `exit`/`error` event. Every past 120s timeout left
that `npm install` process running orphaned in the container, competing for
CPU/IO with every later install attempt (including the four the next
`loadAll()` fires concurrently on each restart) — self-perpetuating, which
is why the identical timeout recurred across three separate process starts
instead of resolving on its own. None of hypotheses 1-4 above were the
actual cause; the "unavailable with no visible load attempt" symptom that
prompted this follow-up was just a stale terminal state from an earlier
failed attempt being re-fetched on refresh, not a new failure mode.

Fix: `#loadOne` now creates an `AbortController` and passes an `onTimeout`
callback into `withTimeout` that aborts it; `installDependencies`/
`runNpmInstall` accept that signal, spawn the shell in its own process group
on POSIX (`detached: true`), and kill the whole group (`process.kill(-pid,
"SIGTERM")`) on abort so the shell's real `npm` child dies too, not just the
shell. Verified with a full `down`/`up -d --build` cycle: all four apps hit
`install-skipped-unchanged` and reached `ready` within ~8 seconds, `GET
/api/applications` reported all four `ready`, and `ps aux` inside the
container showed no lingering `npm` processes afterward.
