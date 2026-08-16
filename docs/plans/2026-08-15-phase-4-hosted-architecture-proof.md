# Phase 4 Hosted Architecture Proof

**Status:** Proposed

**Approved:** pending

**Depends on:** Phase 3 (`GET /api/applications`, `/health`, `/ready`, the
`ConfigService` composition-root pattern) already being implemented, since this
plan extends the same routes and startup sequence rather than replacing them.

## Goal and success criteria

Prove, with fixture adapters only (no real sibling repository is touched),
that HomeBase can safely import, initialize, mount, and dispose compiled
hosted adapters in the same Node process and shared HTTP server, per
`docs/SPECIFICATION.md` §5 and §6. This is the last phase before any real
application (Phase 5) is migrated.

Success means:

- A versioned, compiled-JS-importable `HostedApplication` TypeScript contract
  exists and is exercised by nine independent fixture adapters.
- HomeBase loads enabled applications in stable registry order, mounts their
  routes/static assets/SPA fallback at their reserved base path, attaches
  realtime handlers to the one shared `http.Server`, and reports the real
  lifecycle state machine from `docs/SPECIFICATION.md` §6 through
  `GET /api/applications` (retiring the Phase 3 disabled/unavailable-only
  constraint).
- Import alone never has a side effect (no listen, no file I/O, no timers, no
  signal handlers) — proven by fixtures that record their own side effects.
- No fixture's route, static assets, or SPA fallback can be reached through a
  sibling's base path, and no fixture's realtime attachment can intercept a
  sibling's WebSocket/Socket.IO upgrade.
- Shutdown is bounded, disposes initialized adapters in reverse order,
  disposal is idempotent, and a hung or failing adapter cannot block process
  exit indefinitely or crash the disposal of its siblings.
- HomeBase and every fixture adapter emit structured, application-scoped
  NDJSON log records through one HomeBase-owned pipeline, consistent with the
  draft
  [logging and OpenTelemetry evolution intentions](../features/2026-08-15-logging-and-opentelemetry-intentions.md),
  and this plan closes that document's Phase-4-relevant open decisions.
- The exact `docs/TASKS.md` Phase 4 acceptance gate passes: import safety,
  deterministic realtime ownership, reverse-order idempotent disposal, no open
  handles, safe degraded startup, and no cross-application route or SPA
  fallback collisions.

## Current implementation and boundaries

- `src/services/ConfigService.ts` already validates `contractVersion: 1`,
  resolves `adapterFile` to an absolute path beneath the repository root, and
  requires the compiled file to exist for every `enabled: true` application —
  but never imports it. `ApplicationConfiguration` (`src/config/models.ts`)
  has no `dataPath`, `config`, or logger fields yet; this plan adds them.
- `src/startServer.ts` composes `ConfigService.load` → `createApp` →
  `createHttpServer` → `initializeDashboard` → `listen`, all pre-listen and
  synchronous-per-step. Phase 4 inserts adapter loading into this same
  pre-listen sequence so `GET /ready` continues to mean "startup
  reconciliation has completed" (§6) without adding background polling.
- `src/routes/applications.ts` currently hardcodes `state` to
  `"disabled" | "unavailable"` (the deliberate Phase 3 constraint, §4.2). This
  plan replaces that mapping with the full seven-state union sourced from a
  new `ApplicationHost`.
- No `contracts/`, `shared/`, or adapter-loading module exists anywhere in the
  repo. No WebSocket or Socket.IO dependency is installed. No structured
  logger exists; `main.ts` and `startServer.ts` use bare `console.*` and there
  is no `SIGTERM`/`SIGINT` handling at all today — Phase 4 adds all of it.
- Out of scope for this plan: any change to a real sibling repository (Phase
  5), Docker/Tailnet packaging (Phase 6), OpenTelemetry export or a
  centralized log backend (deferred phases of the logging intentions
  document), authentication, and any mutation endpoint.

## Architecture and interfaces

### Hosted adapter contract

Add `src/contracts/hostedApplication.ts` as the versioned, HomeBase-owned
contract module. It lives in `src/` rather than a separate package for v1 —
no sibling repository imports it directly yet (each compiled adapter only has
to satisfy the *shape*, not import HomeBase's TypeScript source), and
extracting a standalone package is deferred until a Phase 5 plan needs it.

```ts
export const HOSTED_CONTRACT_VERSION = 1 as const;

export type ApplicationLifecycleState =
  | "disabled" | "loading" | "initializing"
  | "ready" | "degraded" | "unavailable" | "stopping";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface ApplicationLogger {
  child(bindings: Readonly<Record<string, unknown>>): ApplicationLogger;
  log(level: LogLevel, event: string, message: string,
      context?: Readonly<Record<string, unknown>>): void;
  flush?(): Promise<void>;
}

export interface HostedApplicationStatus {
  readonly state: "ready" | "degraded";
  readonly summary: string;
  readonly since: string; // ISO-8601
}

export interface ActiveWorkStatus {
  readonly hasActiveWork: boolean;
  readonly description?: string;
}

export type Disposer = () => Promise<void> | void;

export interface HostedApplicationOptions {
  readonly applicationId: string;
  readonly repositoryRoot: string;
  readonly basePath: `/${string}/`;
  readonly hostOrigin: string | undefined;
  readonly dataPath: string;
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly logger: ApplicationLogger;
}

export interface HostedApplication {
  readonly contractVersion: typeof HOSTED_CONTRACT_VERSION;
  initialize?(): Promise<void>;
  router?: import("express").Router;
  staticAssets?: { readonly directory: string; readonly spaFallback: boolean };
  attachRealtime?(server: import("node:http").Server): Promise<Disposer | void>;
  getStatus(): Promise<HostedApplicationStatus>;
  getActiveWork?(): Promise<ActiveWorkStatus>;
  dispose?(): Promise<void>;
}

export type CreateHostedApplication =
  (options: HostedApplicationOptions) => HostedApplication;
```

- A compiled adapter's ES module **default export must be a
  `CreateHostedApplication` factory function**, not a pre-built object. This
  is what makes "importing an adapter must not ..." (§5) enforceable:
  evaluating the module performs only module-level declarations; the factory
  call constructs the object from injected options and must still perform no
  I/O; all real resource acquisition happens inside `initialize()`.
- `basePath` is always the reserved `/${slug}/` form already computed by
  `ConfigService`; adapters must not hardcode their own slug.
- `hostOrigin` is intentionally optional and informational only (e.g. an
  operator-set public origin string) — v1 does not require adapters to depend
  on an absolute origin; relative paths under `basePath` remain canonical.
  Add it as `HOMEBASE_PUBLIC_ORIGIN` (optional environment override, no
  validation beyond non-empty) surfaced through `ConfigService`.
- `config` is new, optional, per-application opaque JSON. Add an optional
  `adapterConfig` object property to `config/homebase.schema.json`'s
  `application` definition (`"type": "object"`, no nested schema — HomeBase
  does not interpret it) and thread it through `ApplicationConfiguration` and
  `RegistryApplication`. This is an allowed refinement of an "undecided
  implementation detail" under `docs/SPECIFICATION.md` §9.

### Runtime data root and per-application data path

Add a required `HOMEBASE_DATA_PATH` environment variable, validated in
`ConfigService.load` exactly like `HOMEBASE_WORKSPACE_PATH` (absolute,
must resolve to an existing directory via `realpath`). This is the "HomeBase
runtime-data root" the logging intentions document leaves open. Layout:

- `<dataRoot>/homebase/log/homebase.ndjson` — HomeBase's own root log.
- `<dataRoot>/apps/<applicationId>/` — one writable directory per configured
  application, created by HomeBase (via `mkdir(..., { recursive: true })`)
  **before** `initialize()` is called, so adapters never infer or create
  their own writable root, satisfying §2.3 and the "importing must not create
  files" constraint (creation happens during the initializing phase, not at
  import).

`ConfigurationPaths` gains a `dataRoot: string` field; `ApplicationConfiguration`
gains a `dataPath: string` field (`<dataRoot>/apps/<id>`) and an
`adapterConfig: Readonly<Record<string, unknown>> | undefined` field.

### Structured logging (closing the intentions document's Phase 4 decisions)

Add `src/logging/`:

- `NdjsonSink.ts` — owns one append-only `fs.WriteStream` to
  `<dataRoot>/homebase/log/homebase.ndjson`. Bounded by a **50 MiB** active
  file size; time-based rotation at UTC midnight; retains the **7** most
  recent rotated files; deletes the oldest rotated file first if total log
  disk usage would exceed a **500 MiB** soft budget. File permissions use the
  process default umask — v1 is single-tenant per container/dev machine, so
  no additional `chmod` is applied. A write failure (disk full, permission
  error, rotation failure) does not throw into caller code: the sink falls
  back to a single structured `stderr` line per dropped record, marks an
  internal (non-public) `loggingDegraded` flag, and never blocks or retries
  unboundedly. **`loggingDegraded` never changes `GET /health` or
  `GET /ready`** — it is observable only through structured log/status
  context, matching the intentions document's requirement that a decision be
  made and documented here.
- `RootLogger.ts` — implements `ApplicationLogger`, constructed once in
  `startServer.ts` before any application loads, bound to
  `serviceName: "homebase"` and a random `serviceInstanceId`
  (`crypto.randomUUID()`). `.child({ applicationId })` returns a bound child
  logger passed into each adapter's `HostedApplicationOptions.logger`; the
  child cannot rebind `applicationId` or `serviceName`. Emits the NDJSON
  fields listed in the intentions document (§4): `timestamp`, `severityText`,
  `body`, `eventName`, `serviceName`, `serviceInstanceId`, `applicationId`,
  `component`, `requestId`, `attributes`, `error`; `traceId`/`spanId` stay
  absent (no tracing yet, per intentions doc §5). Default minimum level is
  `info`; `HOMEBASE_LOG_LEVEL` (optional: `trace`|`debug`|`info`|`warn`|
  `error`|`fatal`) overrides it. In non-production `NODE_ENV`, `info` and
  above are also mirrored to the console as a single readable line; the
  NDJSON file always receives every level at or above the configured minimum.
- `redact.ts` — a small allow-list-oriented sanitizer applied to `attributes`
  and `error` before serialization: drops `authorization`/`cookie`/
  `set-cookie` headers, any key containing `token`, `secret`, `password`, or
  `apikey` (case-insensitive), truncates string values over 2 KiB, and caps
  arrays/objects at 50 entries. Tests assert canary secrets never reach the
  file or console.
- `requestContext.ts` — one `AsyncLocalStorage<{ requestId: string }>`;
  `src/app.ts` gets a small middleware, mounted first, that reads an inbound
  `X-Request-Id` or generates one, sets response header, and runs the rest of
  the request inside the store so `RootLogger` can read `requestId`
  automatically without every call site passing it explicitly.
- `flush(deadlineMs = 2000)` bounded flush is called once during shutdown,
  after all adapters have been disposed, so their own final lifecycle log
  records are not lost.

This closes every "Decisions required before approval" item in the intentions
document that is scoped to Phase 4 (runtime-data root, size/retention limits,
permissions, console mirroring, readiness impact of sink failure, flush
deadline). Central collection, Git-revision enrichment, and OpenTelemetry
export remain out of scope, per that document's Phase C–F.

### Adapter loading: `ApplicationHost`

Add `src/services/ApplicationHost.ts`, mirroring `ConfigService`'s
static-factory/immutable-instance shape:

```ts
export interface LoadedApplication {
  readonly application: ApplicationConfiguration;
  readonly state: ApplicationLifecycleState; // excludes "disabled"; see below
  readonly summary: string;
  readonly since: string;
  readonly instance: HostedApplication | undefined; // present once loading succeeds
  readonly realtimeDisposer: Disposer | undefined;
}

export class ApplicationHost {
  static async loadAll(
    configService: ConfigService,
    rootLogger: ApplicationLogger,
  ): Promise<ApplicationHost>;

  mountAll(app: Express): void;              // routers/static/stubs, pre-listen
  async attachRealtime(server: Server): Promise<void>; // post-server, pre-listen
  async statusFor(id: string): Promise<{ state: ApplicationLifecycleState; summary: string }>;
  async shutdown(): Promise<void>;
}
```

**Per-application load sequence (stable registry order, one at a time — not
parallel, so log ordering and shared-nothing assumptions stay simple for v1):**

1. `enabled: false` → `state: "disabled"`, no import, nothing else happens.
2. `state: "loading"` — dynamic `import(pathToFileURL(adapterFile).href)`
   with a **5000 ms** timeout (`Promise.race` against a timer). Failure
   (throw, timeout, no default export, default export not a function) →
   `state: "unavailable"`, sanitized summary
   (`"The hosted adapter could not be loaded."`), full error only in a
   structured log record; stop here for this application.
3. Call the default-export factory with `HostedApplicationOptions` built from
   the `ApplicationConfiguration` (`dataPath` directory is created first).
   The factory call is synchronous but still guarded by the same loading
   phase/timeout budget. A thrown error or a returned value missing
   `getStatus` or with `contractVersion !== HOSTED_CONTRACT_VERSION` →
   `state: "unavailable"` (`"The hosted adapter is incompatible or failed to
   initialize."`), stop here. This is a genuine runtime check even though the
   registry already requires `contractVersion: 1` — the compiled file's
   actual export is never read at config-load time, so a stale build can
   still disagree at runtime.
4. `state: "initializing"` — `await instance.initialize?.()` with a
   **10000 ms** timeout. Rejection or timeout → `state: "unavailable"`
   (`"The hosted adapter failed to initialize."`); per §5, HomeBase does
   **not** call `dispose()` here — the adapter is contractually responsible
   for releasing anything it partially acquired before rejecting.
5. On success (or no `initialize` method): the application is **loaded**.
   `router`/`staticAssets` are read synchronously for later mounting.
   `state` is not hardcoded to `"ready"` here — see status reporting below.

**Mounting (`mountAll`, called once, before `createHttpServer`):** for every
non-`disabled` application, mount exactly one handler at its
`ApplicationConfiguration.basePath`, so route/SPA-fallback isolation holds by
construction (Express prefix routing plus exactly one mount per base path,
never an unprefixed wildcard). An application's own API routes are just more
routes on its `router`, reachable under its own `basePath` — e.g.
`/lmapi/...` — never under HomeBase's reserved `/api` prefix:

- Loaded application with a `router` → `app.use(basePath, router)`.
- Loaded application with `staticAssets` → `express.static(directory, {
  fallthrough: !spaFallback })`; if `spaFallback` is `true`, add a trailing
  catch-all inside that same `basePath`-scoped router that serves
  `index.html` from `directory` for any unmatched sub-path; if `false`, an
  unmatched sub-path 404s within that base path.
- Loaded application with neither → a trivial scoped 404 inside its own
  `basePath` (still does not fall through to a sibling or to HomeBase's own
  routes).
- `unavailable` application → a scoped stub returning `503` with the
  sanitized `{ state, statusSummary }` body for any request beneath its
  `basePath`, so a failed adapter still "receives an application-scoped
  unavailable response rather than another application's SPA" (§4.1).
- A bare `/${slug}` request 308-redirects to `/${slug}/` (the existing
  `basePath` already encodes the trailing slash; this plan is what first
  gives that field runtime behavior).

**Realtime (`attachRealtime`, called once after `createHttpServer`, before
`listen`):** for every loaded application, `await instance.attachRealtime?.(server)`
with a **5000 ms** timeout, storing the returned `Disposer` if any. A
throwing/timing-out `attachRealtime` is logged and does **not** flip the
application back to `unavailable` — realtime is a supplementary capability;
the adapter is expected to reflect any resulting impairment through its own
`getStatus()`. **Deterministic ownership contract:** every fixture (and every
future adapter) that calls `attachRealtime` must check `request.url` against
its own `basePath` before accepting a Node `'upgrade'` event or a Socket.IO
`path`-scoped handshake, and must ignore/`destroy()` sockets it does not own.
Because base paths are disjoint by construction (unique slugs), this
per-adapter check is sufficient for exactly one adapter to ever claim a given
upgrade regardless of attach order — proven by the WebSocket and Socket.IO
fixtures both attaching to the same shared server.

**Status reporting (`statusFor`, called live by the applications route, no
caching, no polling):**

- `disabled` / `loading` / `initializing` / `unavailable` reflect the
  `ApplicationHost`-tracked state machine directly.
- Once loaded, `statusFor` calls `instance.getStatus()` live with a
  **2000 ms** timeout. A `"ready"`/`"degraded"` result passes through
  verbatim. Any other outcome — an unexpected value, a throw, or a timeout —
  is treated as `"degraded"` with a generic summary and logged as a contract
  violation; it must never silently present as `"ready"` and must never mark
  the *other*, healthy applications degraded (§6: "does not falsify the
  status of healthy applications").
- After `shutdown()` begins, every loaded application reports `"stopping"`
  regardless of what `getStatus()` would say.

**Shutdown (`shutdown`, invoked once from `startServer`'s returned
`StartedHomeBase.close()`):**

1. Log `shutdown-begin`; flip the internal "stopping" flag read by
   `statusFor`.
2. `server.close()` — stops accepting new connections, lets in-flight
   requests finish.
3. For every loaded application, `getActiveWork?.()` with a **2000 ms**
   timeout each; if any report `hasActiveWork: true`, wait once for a shared
   **5000 ms** grace window, then proceed regardless (v1 does not implement
   unbounded draining — documented, deliberate).
4. Dispose loaded applications in **reverse** registry order. Each gets one
   combined **5000 ms** budget covering "call the stored realtime `Disposer`
   if present, then call `instance.dispose?.()`". A throw or timeout is
   logged and disposal moves on to the next application — one hung/broken
   adapter cannot block or fail its siblings' disposal. Disposal is
   idempotent: `shutdown()` itself guards against being invoked twice with an
   internal `already-shutting-down` check.
5. Bounded root-logger `flush(2000)`.
6. An overall **20000 ms** watchdog timer started at step 1 force-calls
   `process.exit(1)` if steps 2–5 have not completed by then, logging a
   `fatal` `shutdown-timeout` record first if the sink is still writable.

`main.ts` registers `SIGTERM`/`SIGINT` handlers that call this `shutdown()`
once and then `process.exit(0)` on success (new — none exist today).

### `GET /api/applications` and route wiring changes

- `src/routes/applications.ts`: `ApplicationListingState` becomes the full
  seven-value union from the contract module. `createApplicationsRouter` now
  takes `(configService, applicationHost)` and calls
  `applicationHost.statusFor(application.id)` per entry (parallelized with
  `Promise.all`, each call already internally bounded at 2000 ms, so the
  whole endpoint stays bounded even with several applications). Sanitization
  rule is unchanged: build the response object field-by-field, never leak
  `repoPath`/`adapterFile`/`dataPath`/`adapterConfig`.
- `src/app.ts`: gains the request-ID middleware (mounted first), then the
  existing `/api` and health routers, then `applicationHost.mountAll(app)`
  last (after HomeBase's own reserved routes, before dashboard `/` mounting
  in `dashboardHost.ts` — dashboard's `/` route does not conflict with any
  application base path since `/` itself is reserved and no slug can be
  empty).
- `src/startServer.ts` sequence becomes: load config → construct
  `RootLogger` → `ApplicationHost.loadAll` → `createApp` (now takes
  `applicationHost` too, calls `mountAll`) → `createHttpServer` →
  `applicationHost.attachRealtime(server)` → `initializeDashboard` → `listen`.
  On any failure after adapters have loaded, the existing "close what was
  already opened" pattern extends to also call `applicationHost.shutdown()`.
  `StartedHomeBase` gains `close(): Promise<void>` that runs
  `applicationHost.shutdown()` then closes the dashboard controller and the
  HTTP server, for both the signal-handler path and test teardown.

### Fixture adapters

Add `test/fixtures/adapters/`, one small TypeScript module per fixture,
compiled by the test build the same way a real adapter would be (or imported
directly via `tsx`/Vitest's transform — decide during implementation whichever
keeps import-safety assertions closest to real dynamic `import()`; either way
each fixture module must export a `CreateHostedApplication` default export).
Every fixture pushes onto its own module-level `readonly effects: string[]`
array only from inside a real contract method call (never at module scope or
inside the factory body), so import-safety tests assert `effects.length === 0`
immediately after `import()` and after the factory call, before `initialize()`
runs.

1. **routes** — a `router` with two GET endpoints; proves basic mount/response.
2. **static-assets** — `staticAssets.directory` pointing at a small checked-in
   fixture folder (`test/fixtures/adapters/static-assets/public/`) with an
   `index.html` and one nested asset; `spaFallback: false`.
3. **spa-fallback** — same shape as #2 with `spaFallback: true`; proves an
   unmatched sub-path under its base path serves its own `index.html`, never
   a sibling's.
4. **websocket** — uses `ws` (`{ noServer: true }`), attaches an `'upgrade'`
   listener in `attachRealtime`, checks `request.url` against its own base
   path before calling `handleUpgrade`.
5. **socket-io** — uses `socket.io` with `path` set to its base path plus
   `/socket.io`; attached to the same shared server as #4 in the isolation
   test to prove no cross-talk regardless of attach order.
6. **degraded** — `getStatus()` deterministically returns `"degraded"` with a
   fixed summary (simulates an impaired optional dependency); never throws.
7. **failing** — `initialize()` acquires an in-memory handle, then throws;
   proves it released that handle itself (asserted via the fixture's own
   `effects` log showing an internal cleanup effect before the throw) and
   that `ApplicationHost` never calls `dispose()` on it.
8. **active-work** — `getActiveWork()` returns `hasActiveWork: true` for a
   scripted duration, then `false`; used to prove the shutdown grace window
   is honored and bounded.
9. **cleanup** — holds a `setInterval` handle and a fake "socket" object;
   `dispose()` clears the interval and closes the socket; calling `dispose()`
   a second time is a no-op (idempotency asserted directly, and via Vitest's
   `vi.useFakeTimers()` plus a process-handle diff showing no leftover timer).

Add `ws` and `socket.io` (plus `socket.io-client` as a dev dependency for
fixture #5's test) to `package.json`.

## Implementation sequence

1. Add `src/contracts/hostedApplication.ts` with the types above.
2. Extend `config/homebase.schema.json` (`adapterConfig`), `src/config/models.ts`
   (`dataRoot`, `dataPath`, `adapterConfig`, `HOMEBASE_PUBLIC_ORIGIN` source),
   and `ConfigService.load` (validate `HOMEBASE_DATA_PATH`, create per-app
   data directories) with matching unit tests.
3. Add `src/logging/` (`NdjsonSink`, `RootLogger`, `redact`, `requestContext`)
   with unit tests: NDJSON shape, redaction of canary secrets, rotation/size
   boundary, degraded fallback on write failure, bounded flush.
4. Add `src/services/ApplicationHost.ts` implementing load/mount/attach/
   status/shutdown as specified above, with unit tests using two or three of
   the fixtures directly (not yet through the full `startServer` path).
5. Add the nine fixture adapters under `test/fixtures/adapters/` plus the
   fixture static-assets folder.
6. Update `src/routes/applications.ts`, `src/app.ts`, `src/startServer.ts`,
   `src/main.ts` (signal handlers) per the wiring section; update their
   existing tests for the new constructor signatures.
7. Add integration tests (see below) exercising `startServer` end-to-end with
   a `ConfigService` built from a temporary registry that enables several
   fixtures at once, plus one disabled and one intentionally-broken (missing
   compiled file — still covered by the existing `ENABLED_ADAPTER_MISSING`
   config-load check) application.
8. Run `npm run typecheck`, `npm test`, `npm run build`.
9. Manually verify against `npm start` with a local scratch registry
   enabling a subset of fixtures: confirm `GET /api/applications` reports
   real states, confirm route/static/SPA isolation by hand, confirm a
   WebSocket and a Socket.IO client can each reach only their own fixture,
   confirm `Ctrl+C` triggers the logged shutdown sequence and exits cleanly,
   inspect `<dataRoot>/homebase/log/homebase.ndjson` for well-formed records
   with no secrets.
10. Update `README.md` (`HOMEBASE_DATA_PATH`, `HOMEBASE_PUBLIC_ORIGIN`,
    `HOMEBASE_LOG_LEVEL`, log file location, how to point at fixture
    adapters for manual testing) and `.env.example`.
11. Update `docs/SPECIFICATION.md`: fix down the previously-open hosted
    contract type sketch in §5 to the concrete types added here (still
    additive, not contradicting existing text), remove the Phase-3-only
    `disabled`/`unavailable` constraint language in §4.2/§6 now that all
    seven states are reachable, and record the workspace/data-path and
    logging decisions made in this plan.
12. Update the draft
    [logging and OpenTelemetry evolution intentions](../features/2026-08-15-logging-and-opentelemetry-intentions.md)
    document: mark its Phase-4-scoped "Decisions required before approval"
    items resolved with a pointer to this plan, consistent with its own
    "Initial-plan acceptance gate" section.
13. Update `docs/TASKS.md`: link this plan from Phase 4, check off completed
    items as their evidence passes, and mark Phase 4 `Done` only once the
    full acceptance gate passes.

## Test and acceptance plan

### Automated tests

- **Import safety:** for each fixture, importing the compiled module and
  invoking only the factory leaves `effects` empty; only calling `initialize()`
  (where present) appends to it.
- **Compatibility and failure handling:** a fixture whose factory returns
  `contractVersion: 2` (a throwaway test-only variant) yields `unavailable`
  without calling `initialize`; the `failing` fixture yields `unavailable`
  without `ApplicationHost` calling `dispose`; an import that throws yields
  `unavailable` with a sanitized summary and a full error only in the log
  capture.
- **Mounting and isolation:** with `routes`, `static-assets`, and
  `spa-fallback` all enabled simultaneously, requests to each fixture's base
  path never return another fixture's content; an unmatched path under
  `spa-fallback`'s base path returns its own `index.html`; an unmatched path
  under `static-assets` (no SPA fallback) 404s within that base path; a bare
  `/${slug}` request 308-redirects to `/${slug}/`.
- **Realtime isolation:** with `websocket` and `socket-io` both attached to
  one shared `http.Server` (test both attach orders), a client connecting to
  each fixture's own path reaches only that fixture; a client connecting to
  neither path gets the connection destroyed by neither/both fixtures
  (i.e. no double-handling), verified via each fixture's own connection
  counter.
- **Status honesty:** `degraded` fixture always reports `degraded`, never
  `ready`; a fixture whose `getStatus()` throws is presented as `degraded`
  with a generic summary, and a sibling `ready` fixture in the same run still
  reports `ready` (proves one broken app doesn't falsify another's status).
- **Shutdown:** `active-work` fixture delays the grace window as scripted but
  shutdown still completes within the documented bound; `cleanup` fixture's
  interval/socket are closed exactly once even if `shutdown()` races with the
  watchdog; a fixture whose `dispose()` hangs past its 5000 ms budget does not
  block a sibling's disposal (assert via ordering + elapsed time in the test).
- **Logging:** canary secrets placed in fixture-emitted `attributes`/`error`
  context never appear in the NDJSON file or console mirror; multiline error
  stacks remain single physical lines; a simulated sink write failure falls
  back to the stderr path and does not throw into `ApplicationHost` or change
  `/ready`.
- Existing Phase 1–3 suites (`ConfigService`, `applications`, `health`,
  dashboard component/integration tests) continue to pass unmodified in
  behavior, only in constructor signatures where this plan changes them.
- `npm run typecheck`, `npm test`, `npm run build` all pass.

### Manual verification

- `npm run build && npm start` with a scratch registry enabling a mix of
  fixtures (including one intentionally missing its compiled file, to
  confirm the existing Phase 1 `ENABLED_ADAPTER_MISSING` startup rejection is
  unaffected by this plan).
- Browser check of each mounted fixture's route/static/SPA behavior at its
  base path, and confirm `/somefixture` redirects to `/somefixture/`.
- A manual WebSocket client and a manual Socket.IO client each connect to
  their respective fixture and confirm the other fixture never receives the
  connection.
- `Ctrl+C` the running process; confirm the console/NDJSON log shows
  `shutdown-begin`, each fixture's disposal, `shutdown-complete` (or the
  watchdog `fatal` record if deliberately induced by a hung test fixture),
  and a clean process exit with no dangling handles (`node --trace-warnings`
  shows no `MaxListenersExceededWarning` or open-handle warning).
- Inspect `<dataRoot>/apps/<id>/` directories exist and are writable, and
  `<dataRoot>/homebase/log/homebase.ndjson` contains well-formed, redacted
  records for the whole run.

## Deployment, rollback, and assumptions

- New required environment variable: `HOMEBASE_DATA_PATH`. Local development
  and any existing deployment must set it (documented in `.env.example`) or
  startup fails with the same actionable-error pattern as
  `HOMEBASE_WORKSPACE_PATH` — this is a deliberate breaking addition to the
  v1 environment contract, called out in the `README.md`/`SPECIFICATION.md`
  updates.
- No registry schema field becomes required; `adapterConfig` is optional and
  additive, so existing `config/homebase.json` files remain valid without
  changes (all current sample applications stay `enabled: false`, so no
  adapter is actually loaded by today's local registry until a developer
  opts a fixture or real application in).
- Rollback removes `src/contracts/`, `src/logging/`, `src/services/
  ApplicationHost.ts`, the fixture tree, and reverts `applications.ts`/
  `app.ts`/`startServer.ts`/`main.ts` to their Phase 3 shape; it also removes
  the `HOMEBASE_DATA_PATH` requirement. No data migration is at risk since
  `<dataRoot>` is new, HomeBase-created, and not depended on by anything
  before this plan.
- Assumes Phase 3 is fully merged (it is — `docs/TASKS.md` marks it `Done`)
  so this plan builds on the real `GET /api/applications` implementation
  rather than fixture wiring.
- Assumes no real sibling repository is touched or migrated in this plan —
  that remains individually scoped, aligned Phase 5 work per repository, only
  unblocked once this plan's acceptance gate passes.
