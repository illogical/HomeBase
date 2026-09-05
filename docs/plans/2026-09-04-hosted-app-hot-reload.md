# Hosted-application hot reload (development)

**Status:** In progress — implemented and covered by automated tests; live
verification against the running `homebase-dev` container and real sibling
repositories is still outstanding (see "Validation" below).

**Supersedes the analysis in:**
[2026-09-03-hosted-app-hot-reload-gap-analysis.md](2026-09-03-hosted-app-hot-reload-gap-analysis.md)
— that document named the gap and recommended closing it in two separable
steps. This plan implements both, in that order.

> [!IMPORTANT]
> This plan was written alongside its implementation, at the user's explicit
> request to "take a stab at implementing" the gap analysis, rather than being
> aligned and approved in a prior session as `AGENTS.md` normally requires. Two
> decisions in it were made on the implementer's judgement and deserve a
> deliberate review: the specification change in §"Specification impact", and
> automatic sibling builds being **on** by default in development.

## Goal

Close the edit → browser loop for hosted sibling applications: changing a
sibling's API or web app source should show up through Docker-hosted HomeBase
without a manual rebuild and without restarting HomeBase.

### Success criteria

- Editing a sibling's backend source ends with that sibling's API serving the
  new code, with no manual command and no HomeBase restart.
- Editing a sibling's frontend source ends with the rebuilt bundle served on the
  next browser refresh.
- A failed build leaves the previously loaded adapter running and says so in the
  log.
- Nothing in this feature runs in production.
- HomeBase's own hot reload, `npm run rebuild:dev`, startup, and shutdown are
  unchanged.

### Out of scope

- True frontend HMR for a hosted application (proxying a sibling's own Vite dev
  server through HomeBase). A rebuilt static bundle plus a browser refresh is
  what this delivers.
- Worker-thread or child-process isolation for adapters. `SPECIFICATION.md` §2.1
  keeps hosted applications in HomeBase's process; the gap analysis is right
  that changing that is its own decision, not a reload detail.
- Any production reload, build, or restart capability.
- Dashboard UI. Reload is automatic; a manual trigger exists as an API endpoint.
  A reloading application already shows as `loading` on the dashboard, which
  polls non-terminal states, so a card recovers on its own.

## Architecture

### 1. `ApplicationHost.reload(id)` — `src/services/ApplicationHost.ts`

Reuses all three building blocks the gap analysis identified:

- **Instance-swap-aware routing** already in `mountApplication()`: the mounted
  router rebuilds its cached handler whenever `record.instance` changes
  identity, so swapping the field is the whole routing story. No route is
  re-registered.
- **Per-instance disposal**, extracted from `#disposeAll()` into
  `#disposeRecord(record)` and now shared by shutdown and reload.
- **The load pipeline**, `#loadOne()`, which now takes `{ cacheBust }`.

Sequence: mark `loading` → dispose the old instance → clear `instance`/
`realtimeDisposer` → `#loadOne(record, { cacheBust: true })` → `#loadOne` sets
`loaded` and re-attaches realtime.

Decisions:

- **Dispose before load, not after.** A load-then-swap would keep the old
  instance serving during the swap, but two live instances would both hold the
  adapter's exclusive resources (a database file, a socket). Releasing first is
  the safer default for real adapters; the price is that a failed reload leaves
  the application `unavailable`, which is reported honestly rather than hidden.
- **No new lifecycle state.** A reload transitions through the existing
  `loading` → `initializing` → terminal path with its own `since` timestamp and
  a reload-specific summary. The dashboard needs no change to display it.
- **One reload per application at a time**; a concurrent request is refused
  (`busy`) rather than queued.
- **Cache-busted import** (`?homebaseReload=<now>`), accepting the bounded
  per-reload memory leak the gap analysis describes. Never set on the startup
  path.
- `#pendingLoads` became a live set (entries remove themselves on settle) so a
  long session of reloads doesn't retain a settled promise each.

### 2. `DevReloadService` — `src/services/DevReloadService.ts`

Two independent polled signals per enabled application:

| Signal | Watched | Cost | Action |
| --- | --- | --- | --- |
| Adapter | `adapterFile` (one file) | one `stat` | `host.reload(id)` |
| Source | repository tree, minus generated directories | `stat` per file | run the sibling's build scripts |

- **Polling, not `fs.watch`** — the same Docker-Desktop/Windows-bind-mount
  reason `CHOKIDAR_USEPOLLING` and `nodemon --legacy-watch` already exist.
- **Two-observation settling**: a signature must be seen identically on two
  consecutive passes before it is acted on. This debounces editor write bursts
  and prevents importing an adapter a build is still writing. The first pass is
  a baseline only, so startup never triggers a build.
- **Separate intervals**: the adapter check runs every pass (default 1000 ms);
  the source scan, which is thousands of syscalls over a bind mount, runs every
  2000 ms by default.
- **No self-triggering loop**: `dist`, `build`, `out`, `node_modules`,
  `coverage`, `target`, `vendor` and dotted directories are excluded from the
  source scan at any depth; `data`, `logs`, `tmp`, `temp` at the repository root
  only, so a real `src/data` still counts. Scans are capped at 5000 files, with
  one warning if a repository exceeds it.
- **Build steps** are read live from the sibling's own `package.json`, matching
  `scripts/rebuildApps.mjs` exactly: `build:hosted` if present else `build`,
  then `build:host`. `installDependencies` (already signature-cached) runs
  first, so a dependency change installs and an ordinary edit does not.
- **Builds and reloads run outside the polling pass** so a slow build never
  stalls the watcher; they are tracked so `stop()` and tests can await them. An
  edit landing mid-build queues exactly one more pass.
- **The two halves are decoupled**: this service's builds, a manual
  `npm run rebuild:dev -- --no-restart`, and a sibling's own `--watch` build all
  converge on the same adapter watch, so either half is useful alone.

### 3. Wiring — `src/startServer.ts`

Constructed only when `mode === "development"`, via
`DevReloadService.fromEnvironment(process.env, …)`, which returns `undefined`
when switched off. `stop()` runs before `applicationHost.shutdown()` so shutdown
never begins mid-swap. The production path constructs nothing.

Switches (all development-only): `HOMEBASE_DEV_HOT_RELOAD`,
`HOMEBASE_DEV_AUTO_BUILD`, `HOMEBASE_DEV_HOT_RELOAD_APPS`,
`HOMEBASE_DEV_WATCH_INTERVAL_MS`, `HOMEBASE_DEV_SOURCE_SCAN_INTERVAL_MS`.
Documented in `.env.example`, `.env.docker.example`, and the README.

### 4. `POST /api/applications/:id/reload` — `src/routes/applications.ts`

Manual trigger for the same reload, responding once the swap has settled:
`200 { state, statusSummary }`, `409 { error }` for `disabled`/`busy`/
`shutting-down`, `404 { error: "unknown" }`. It re-imports what is on disk and
never builds.

## Specification impact

`SPECIFICATION.md` §4.2 read "V1 provides no create, update, delete, reload,
build, or restart endpoint." The reload endpoint contradicts that sentence
directly, so the specification was updated in the same work:

- §4.2 now excludes create/update/delete/build/restart and configuration
  mutation, and names the two lifecycle-only exceptions that re-run the load
  pipeline for one application: the pre-existing `retry` endpoint (which the
  sentence already did not describe) and the new `reload`.
- New §6a "Adapter reload" documents the dispose-then-load sequence, that no
  lifecycle state is added, that a failed reload can follow a success, the
  concurrency rule, and the ESM-cache leak and `dispose()` hygiene that make
  reload a development affordance.

**This is the change most in need of the user's review.** The narrower
alternative is to drop the HTTP endpoint and keep reload reachable only from the
watcher, which would leave §4.2 untouched.

## Failure modes

| Failure | Behavior |
| --- | --- |
| Build script fails | Later steps skipped; `dev-build-failed` logged with the last 40 output lines; previously loaded adapter keeps serving. |
| Build succeeds, adapter fails to import/initialize | That application goes `unavailable` with the existing summary; others unaffected; the next successful reload restores it. |
| `dispose()` hangs | Bounded by the existing `DISPOSE_TIMEOUT_MS`; logged `dispose-failed`; reload proceeds. |
| Requests during the swap | `503 { state, statusSummary }`, the same body any not-yet-loaded application returns. |
| Concurrent reloads | Second is refused `busy`. |
| Shutdown during a reload | `stop()` awaits in-flight work; reload after shutdown begins is refused. |
| Repository too large to scan | One `dev-watch-truncated` warning; watching is incomplete; adapter reload still works. |
| Adapter leaks on `dispose()` | Accumulates across reloads. Development-only; restart the dev container. |

## Validation

**Automated (passing):**

- `test/services/ApplicationHostReload.test.ts` (6) — writes a real adapter to a
  temp workspace and rewrites it between reloads: responses served through the
  mounted router change `v1` → `v2`, the old instance's `dispose()` ran first, a
  broken adapter reports `unavailable` and returns 503, a later good build
  recovers it, unknown/shutting-down/busy rejections, and the HTTP endpoint.
- `test/services/DevReloadService.test.ts` (10) — baseline pass is inert, source
  change builds only after settling, failing step halts the chain, adapter
  change reloads exactly once, `autoBuild: false` still reloads, generated
  directories ignored, scan interval respected, script selection, environment
  switches. One test uses the real spawn-based runner end to end: a source edit
  runs an actual `npm run build:host`, whose write to the adapter file is then
  picked up by the adapter watch and reloaded.
- `npm run typecheck` clean; full `npm test` shows only the three failures that
  are already present on `main` (two dashboard `App.test.tsx` cases and
  `ApplicationHost.test.ts`'s SPA-fallback isolation case — confirmed by
  stashing this work and re-running).

**Live, on the Windows host (2026-09-04), not in Docker:** `npm run dev` on a
spare port with `HOMEBASE_DEV_AUTO_BUILD=off` started cleanly, logged
`dev-reload-start`, and loaded the real siblings (LMApi and LMEval `ready`;
DevPlanner and MemoryApi were already failing for unrelated environment reasons
— no Neo4j/vector service reachable outside the container). Updating LMEval's
`dist/host/index.js` timestamp produced, within one poll interval,
`reload-begin` → `dispose-complete` → `reload-complete` → `dev-reload-applied`,
and LMEval remained `ready` and served afterwards. That exercises detection,
disposal, cache-busted re-import, and the instance swap against a real adapter.
The automatic-build half was deliberately left off there, so it has not yet run
against a real sibling repository.

**Not yet done — required before marking this plan Complete:**

- [ ] Run the `homebase-dev` container and confirm an edit to a real sibling
      (e.g. LMEval) backend source rebuilds and hot reloads, end to end, with
      the observed latency recorded here. This is the first exercise of
      automatic builds against a real sibling toolchain.
- [ ] Confirm a frontend edit is served after a browser refresh.
- [ ] Confirm scan cost is acceptable over the Windows-host bind mount for all
      four siblings at once (adjust the default intervals if not).
- [ ] Confirm an adapter with realtime (`attachRealtime`) reconnects after a
      reload — the socket/WebSocket fixtures cover attachment, but a real
      client's reconnect behavior across a swap has not been observed.
- [ ] Confirm a long session's memory growth is tolerable in practice.

## Deferred

- Frontend HMR for hosted applications (proxying a sibling's Vite dev server).
- A dashboard control and per-application build-status surface (today: logs).
- Per-application watch configuration in the registry — the registry schema is
  unchanged; environment switches cover the same need without a schema version
  question.
- Any production use of reload.
