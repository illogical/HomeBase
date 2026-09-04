# Fix sibling install timeouts, skip redundant reinstalls, and add a retry action

## Context

After the non-blocking-startup change (background per-app loading so HomeBase's own dashboard responds immediately instead of waiting on every sibling app), every sibling application started showing `state: "unavailable"`, `"Dependencies could not be installed."` in the dashboard.

Investigation (`data/homebase/log/homebase.ndjson`) found the root cause and two follow-on gaps:

1. **Root cause**: every app's install hits `TimeoutError: installDependencies timed out after 120000ms.` `src/services/installDependencies.ts` runs `npm install --no-package-lock`, which tells npm to **ignore the existing `package-lock.json`** and fully re-resolve the dependency tree from the registry on every single HomeBase startup — even though each sibling app already has a valid, unchanged `node_modules` (150MB+) and lockfile on disk. That full re-resolution is what's timing out, not a broken path or missing npm.
2. **No change-detection**: nothing in the codebase skips this work when nothing has changed (confirmed via search — no hash/mtime/version-stamp mechanism exists anywhere). The fix should be "skip unless something relevant actually changed," not "reinstall from scratch every boot."
3. **No recovery path**: once `ApplicationHost.ts`'s `#loadOne()` marks a record `"unavailable"`, nothing ever retries it — not the existing "Retry loading applications" button (that only re-fetches `GET /api/applications`, it doesn't ask the backend to reload anything), not any backend endpoint. The only fix today is restarting the whole HomeBase process, and the UI gives no visible affordance that a per-app retry is even a concept.

This plan fixes the root cause, adds a `package.json`/lockfile-hash-based skip so installs only happen when something actually changed (preferred over manual version numbers, since a hash can't drift out of sync with reality and needs no developer discipline to bump), and adds a real per-app retry path (backend endpoint + UI button) so a transient failure doesn't require a full restart.

## Design

### 1. Stop forcing a full re-resolve; skip entirely when nothing changed

Rewrite `src/services/installDependencies.ts`'s default `installDependencies` implementation:

- Before spawning anything, compute a signature: SHA-256 over `package.json` + `package-lock.json` (if present) under `application.repositoryRoot`. If `package.json` doesn't exist, there's nothing to install — return immediately (matches today's "missing path" leniency).
- Compare that signature to a small stamp file persisted at `join(application.dataPath, "install-stamp.json")` (`{ signature, installedAt }`) — `application.dataPath` is already the per-app, `mkdir`'d scratch directory (`ApplicationHost.ts` already does `mkdir(application.dataPath, { recursive: true })` before `initialize()`, so this is a proven-safe location per `src/config/models.ts`'s `ApplicationConfiguration.dataPath`).
- If the signature matches the stamp **and** `node_modules` exists under `repositoryRoot`: skip `npm install` entirely, log `install-skipped-unchanged`, return fast.
- Otherwise, run **plain `npm install`** (drop `--no-package-lock`) — this respects the existing lockfile/`node_modules` and only does the (usually small) incremental work needed, instead of a full re-resolve. On success, write the new stamp. On failure, do **not** write the stamp, so the next attempt (including a manual retry, see below) re-tries the real install rather than wrongly believing it's cached.
- Note/tradeoff to record in a code comment: switching off `--no-package-lock` means a genuinely stale lockfile will get rewritten by `npm install`, which could show up as a dirty working tree in a sibling repo's git status — that's an accurate signal (the lockfile really was out of date), not a bug, and is the standard `npm install` behavior every other Node project relies on.
- Keep the existing `INSTALL_TIMEOUT_MS` (120s) in `ApplicationHost.ts` as a safety net for real installs — now rarely exercised since the common case (nothing changed) returns almost immediately.

### 2. Add a per-app retry path

**Backend** (`src/services/ApplicationHost.ts`):
- Store `#hostOrigin` and `#installDeps` as instance fields (set once in `loadAll`) so a later retry can reuse the exact same loading pipeline as the initial boot.
- Add `retry(id: string): boolean`: looks up the record; if missing or not currently `"unavailable"`, return `false` (no-op — don't let a retry interrupt a record that's loading or already loaded). Otherwise reset it to `state: "loading"`, `summary: "Waiting to retry."`, kick off `this.#loadOne(record, ...)` the same way `loadAll` does (pushed into `#pendingLoads` so `settled()` still accounts for it in tests), and return `true` immediately without awaiting completion.

**Route** (`src/routes/applications.ts`): add `POST /applications/:id/retry` — calls `applicationHost.retry(id)`; respond `202` with the current `{ state, statusSummary }` (from `statusFor`) when accepted, `409` with a small `{ error: "not-retryable" }` body when the app isn't currently `"unavailable"` (covers both "already loading" and "unknown id" cases, without leaking which).

**Dashboard plumbing**:
- `dashboard/src/models.ts`: add `retryApplication(applicationId: string, signal?: AbortSignal): Promise<void>` to `DashboardDataSource`.
- `dashboard/src/httpDataSource.ts`: implement it as a `POST` to `/api/applications/${id}/retry`, mirroring the existing `pullGit`/`fetchGit` methods' fetch + status-check pattern (`httpDataSource.ts:70-98`).
- `dashboard/src/fixtures.ts`: implement a fixture version on `FixtureDashboardDataSource` that flips the given app from `"unavailable"` to `"loading"` and then `"ready"` after a short delay, reusing the existing `timers`/`simulate`-style pattern already used for script runs (`fixtures.ts:163-183`), so the fixture scenarios can demonstrate the new button.

**UI** (`dashboard/src/App.tsx`):
- Thread the existing `retry` callback (from `useApplications`, already destructured in `App` at `App.tsx:62`, currently only wired to the empty/error state) down into `ApplicationCard` as a prop.
- For `application.state === "unavailable"` cards, render a "Retry" button next to the status badge (same slot pattern as the existing `ScriptsIcon` flip button for `"ready"` cards, `App.tsx:192-202`), calling `dataSource.retryApplication(application.id)` and then invoking the passed-down `retry()` so `useApplications`' existing polling (added in the prior change) picks the app back up as `"loading"` and follows it through to `"ready"`/`"unavailable"` — no new polling logic needed, it already polls while any app is non-terminal.

This also directly addresses "the UI doesn't make that very clear" — an unavailable card now has an explicit, visible action instead of implying the only fix is restarting HomeBase.

## Verification

- Restart HomeBase locally and confirm all four sibling apps go from perpetual `"unavailable"`/timeout to `"ready"` quickly (since their `node_modules` already exist and are valid, the fixed plain `npm install` should be fast even on the first fixed run; a second restart afterward should hit the skip path near-instantly).
- Unit-test the new signature/skip logic in `installDependencies.ts` directly (hash matches → skip; hash differs → installs and re-stamps; install failure → no stamp written, next call re-attempts).
- Extend `test/services/ApplicationHost.test.ts` with a `retry()` case: an app that fails once (inject a failing `installDependencies` stub) reaches `"unavailable"`, then a second call with a passing stub via `retry()` reaches `"ready"`; also assert `retry()` returns `false`/no-ops for an app that's `"loading"` or already `"loaded"`.
- Add a route test for `POST /api/applications/:id/retry` (`test/routes/applications.test.ts`): success path returns `202` and transitions the app; calling retry on a non-`"unavailable"` app returns `409`.
- Extend `dashboard/src/App.test.tsx` for the new Retry button: visible only on `"unavailable"` cards, clicking it calls `retryApplication` and the card follows the existing loading→ready polling path (same technique as the polling test already added).
