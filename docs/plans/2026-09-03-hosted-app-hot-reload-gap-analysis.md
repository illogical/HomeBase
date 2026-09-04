# Hosted-application hot reload: gap analysis

**Status:** Analysis only — not an implementation plan, not approved.

## Context

HomeBase already has real hot-reload for its own code: the dev Docker image
and bind mount in
[`docs/plans/2026-08-21-docker-development-hot-reload.md`](2026-08-21-docker-development-hot-reload.md)
give `src/**` a Node `--watch` restart and `dashboard/src/**` Vite HMR, both
inside the `homebase-dev` container. What that plan explicitly did not cover
— and what the README (lines 319–328, 397–403) separately and deliberately
lists as deferred beyond v1 — is hot reload for **hosted sibling
applications** (DevPlanner, LMApi, MemoryApi, LMEval). Today, editing a
sibling's source has no visible effect until it's rebuilt and HomeBase
restarts; `npm run rebuild:dev -- --app <id>` (`scripts/rebuildApps.mjs`) is
the documented interim workaround.

This surfaced because a LMEval code change wasn't visible through
Docker-hosted HomeBase, and it was initially assumed that hot reload for
hosted apps had been designed in and then dropped by accident. It wasn't
dropped — it was named and deferred in the same design pass that shipped
HomeBase's own hot reload. This document analyzes what closing that gap
would actually take, so that decision can be made deliberately rather than
by default.

## What exists today

**HomeBase's own hot reload (shipped, out of scope here):** Dockerfile `dev`
stage runs `nodemon --legacy-watch --watch src --ext ts,json --exec "node
--import tsx src/dev.ts"`; `docker-compose.dev.yml` bind-mounts the repo and
sets `CHOKIDAR_USEPOLLING=true` for Vite. This only ever restarts HomeBase's
own process/HMR graph — it has no relationship to sibling apps.

**Sibling apps: load-once, no watch.** `ApplicationHost.loadAll()`
(`src/services/ApplicationHost.ts`) loads every configured application
exactly once at process startup, in `#loadOne()` (lines 326–428):

1. Installs dependencies (`installDependencies.ts`, now signature-cached
   against `package.json`/`package-lock.json` so unchanged repos skip a slow
   `npm install`).
2. Dynamically imports the compiled adapter:
   `const moduleUrl = pathToFileURL(application.adapterFile).href; const
   imported = await import(moduleUrl);` (line 356) — for LMEval this is
   `<HOMEBASE_WORKSPACE_PATH>/LMEval/dist/host/index.js`, per
   `repoPath`/`adapterPath` in `config/homebase.json`.
3. Calls the default-exported factory, then `initialize()`, then
   `attachRealtime()`.

Nothing watches that `dist/` output, and nothing re-imports it. `npm run
rebuild:dev` exists specifically to paper over this: it runs the sibling's
own `build:hosted`/`build` and `build:host` scripts, then restarts the
`homebase-dev` container so `loadAll()` runs again from scratch.

**Reusable building blocks already in place** (this is the encouraging
part — a hot-reload design would not start from zero):

- **Instance-swap-aware routing.** `mountApplication()`/`resolveHandler()`
  (`ApplicationHost.ts` lines 512–542, 466–510) mount one long-lived Express
  router per app whose inner handler is cached and only rebuilt when
  `record.instance` changes identity (line 534: `cachedInstance !==
  record.instance`). If something else swapped `record.instance` to a
  freshly loaded adapter, the router would already pick it up on the very
  next request — no Express route re-registration needed.
- **Per-instance disposal.** `#disposeAll()` (lines 302–316) already calls
  `record.realtimeDisposer()` then `record.instance.dispose?.()` per app,
  under a bounded timeout, as part of process shutdown. The same call
  sequence is what a reload would need to run against just one app before
  loading its replacement.
- **A retry primitive.** `ApplicationHost.retry(id)` (lines 155–167,
  exposed as `POST /applications/:id/retry` in `src/routes/applications.ts`)
  already re-runs `#loadOne()` for a single app on demand. It's currently
  gated to the `unavailable` state only — a `loaded` app can't be retried —
  but the mechanism for "re-run the load pipeline for one app id" already
  exists and works.

## What's actually missing

Three distinct problems, worth naming separately because they have
different shapes and different-sized solutions:

### 1. Auto-rebuilding sibling source

Nothing today runs a sibling's `build:host`/`build:hosted` in watch mode.
`rebuild:dev` is a manual, one-shot script the developer runs by hand after
editing source. Each sibling repo owns its own build tooling (esbuild, tsc,
Vite — whatever it chooses), so there's no single watcher HomeBase could run
generically; it would mean either running N different apps' arbitrary build
commands in watch mode inside (or alongside) the `homebase-dev` container,
or requiring every hosted-app contract implementer to also expose a
standard "watch" script.

### 2. Detecting and re-importing the rebuilt adapter

Node's ESM loader caches modules by resolved URL. Re-`import()`-ing the same
`dist/host/index.js` path after it changes on disk returns the **stale
cached module**, not the new one — this is a hard Node behavior, not a
HomeBase oversight. Two known ways around it, both with a real cost:

- **Cache-busting query string** (`import(moduleUrl + "?t=" + mtime)`): the
  simplest — but every reload leaks the previous module's code and any
  closures/timers/listeners it captured, since Node's loader has no way to
  actually unload an ESM module from memory. Repeated reloads inside one
  long-lived container process would accumulate that leaked memory
  indefinitely.
- **Worker thread / child process isolation**: the adapter loads inside a
  disposable execution context that can be torn down and restarted cleanly.
  This solves the leak, but conflicts with §2.1 of `docs/SPECIFICATION.md`
  ("hosted applications are trusted code... share HomeBase's process,
  memory, environment... failure boundary") and the current
  `HostedApplication` contract (`src/contracts/hostedApplication.ts`), which
  assumes synchronous, in-process access to `router`/`staticAssets` — a
  worker boundary would need those to cross an IPC/serialization boundary
  instead, which is a materially bigger contract change, not a tweak.

### 3. Swapping the live instance safely

`ApplicationHost` has no `reload()` method today. One would need to:

- Dispose the old instance (reusing the existing per-instance disposal
  logic from `#disposeAll()`, lines 302–316), under the same bounded
  timeout.
- Load and `initialize()` the new instance (reusing `#loadOne()`'s existing
  steps 2–4).
- Atomically flip `record.instance` so the router's cache check picks it up.

The open design question is behavior during the swap window and on partial
failure: requests in flight against the old instance while it's disposing,
a new instance whose `initialize()` throws (leaving no working instance
where one existed a moment ago), and no `reloading` state in the
`disabled → loading → initializing → loaded/degraded/unavailable` state
machine defined in `docs/SPECIFICATION.md` §6. Today a failed load only ever
happens once, at startup, before any user has seen the app succeed; a failed
*reload* would be the first time HomeBase needs to describe "this app used
to work and now doesn't, because of a reload."

## Constraints any design has to respect

- **Trust boundary** — `docs/SPECIFICATION.md` §2.1 is explicit that hosted
  apps already share HomeBase's process, memory, and failure boundary. A
  hot-reload design shouldn't quietly change that (e.g. by moving to worker
  isolation) without treating it as its own aligned decision, separate from
  "make reload faster."
- **Contract versioning** — `HostedApplication`/`CreateHostedApplication` is
  explicitly versioned (`contractVersion: 1`). Nothing about reload should
  assume every implementation is well-behaved about releasing listeners,
  timers, or sockets on `dispose()` — a production adapter that leaks on
  dispose today only matters once, at shutdown; under repeated hot reloads
  it would degrade HomeBase itself over a session.
- **Docker file-watch reality** — the Aug 21 plan already had to add a
  polling fallback (`CHOKIDAR_USEPOLLING`, `nodemon --legacy-watch`) because
  native `fs.watch`/inotify events don't propagate reliably from a
  Windows-host bind mount through Docker Desktop. Any sibling-source watcher
  would need the same treatment, plus care to debounce so that watching a
  sibling's own `dist/` output doesn't create a rebuild-triggers-watch-
  triggers-rebuild loop.

## Recommended incremental path (for future alignment, not decided here)

If this gap is worth closing, it's worth closing in two separable steps
rather than one large change:

1. **Adapter-level reload only.** Detect a changed `dist/host/index.js`
   (mtime or content hash) and perform the cache-busted re-import + dispose
   + swap described above. This reuses all three existing building blocks
   (router instance-swap, per-instance disposal, the retry code path
   generalized to run from `loaded` too) and accepts the small per-reload
   memory leak as a known, bounded cost of a long-running dev session. The
   developer would still run the sibling's own build (or `rebuild:dev
   --no-restart`) by hand — this step only removes the "restart the whole
   HomeBase container" half of the workaround.
2. **Automatic sibling source rebuilds.** Only after (1) is working and its
   memory/failure behavior is understood, consider running each sibling's
   own watch/build tooling automatically. This is the larger, more
   speculative half — it means orchestrating N independent build
   toolchains inside or alongside the dev container — and should get its
   own alignment pass rather than being bundled with (1).

Per the project's own convention (README "Planning documents"), neither
step should be treated as scheduled work until it gets its own aligned,
reviewed implementation plan.
