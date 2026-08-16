# Phase 3 Configuration and Status API Integration

**Status:** Complete

**Approved:** 2026-08-15

**Depends on:** the hero/responsive trim in
[dashboard hero and responsive refinement](2026-08-15-dashboard-hero-and-responsive-refinement.md)
being implemented first, so Phase 3 builds on the finished Phase 2 UI rather
than layering API work on top of still-open visual polish.

## Goal and success criteria

Replace the Phase 2 static fixture data source with a real, sanitized,
read-only HTTP API backed by the validated `ConfigService` registry, and add
HomeBase's liveness/readiness endpoints. No mutation endpoints exist in v1.

Success means:

- `GET /api/applications` returns sanitized, presentation-only data for every
  configured application, sourced from `ConfigService`, with no filesystem or
  adapter path ever serialized.
- `GET /health` and `GET /ready` respond `200` once the process/listener and
  validated configuration are up.
- The dashboard loads real configuration data through the existing
  `DashboardDataSource` seam instead of fixtures, with a **one-shot load and
  manual retry** on failure (no background polling, per project decision).
- API contract tests and frontend integration tests prove valid configuration
  renders correctly, private configuration is never present in any response,
  and loading/empty/failure(+retry) presentations remain usable and
  accessible — the exact Phase 3 acceptance gate defined in `docs/TASKS.md`.

## Current implementation and boundaries

- `src/services/ConfigService.ts` is the only class that reads the registry or
  environment; it exposes an immutable `ApplicationConfiguration[]` via
  `configService.applications`, including private fields (`repoPath`,
  `repositoryRoot`, `adapterPath`, `adapterFile`) that must never reach an
  HTTP response.
- `src/app.ts` currently only sets `app.locals.configService`; it registers no
  routes. `src/dashboardHost.ts` mounts `/assets` (production) and Vite
  middleware (development) plus the exact `GET /` route. `RESERVED_SLUGS` in
  `ConfigService` already reserves `api`, `assets`, `health`, and `ready`, so
  no schema/config change is needed to add these routes.
- `dashboard/src/models.ts` already defines `DashboardApplication` and
  `DashboardDataSource` exactly as a future API response should look — this
  plan implements the server side of that contract and a new HTTP-backed
  client implementation, without changing the interface shapes.
- `dashboard/src/fixtures.ts` and its three `?fixture=` scenarios were a
  deliberate Phase 2 prototype-only mechanic. Phase 3 retires the public
  fixture-switching URL from the production app; `FixtureDashboardDataSource`
  remains only as a test fixture imported directly by component tests.
- **Status honesty constraint (deliberate, not an oversight):** hosted-adapter
  loading is Phase 4 scope. HomeBase never imports an adapter in Phase 3, so
  no application can truthfully report `ready`, `degraded`, `initializing`,
  or `stopping` yet. The only two reachable states in Phase 3 are:
  - `disabled` — the registry entry has `enabled: false`.
  - `unavailable` — the registry entry has `enabled: true`, but hosted
    loading isn't implemented until Phase 4; the summary must say so plainly
    (e.g. "Hosted adapter loading is not implemented yet.") rather than
    implying a real failure.
  This must be implemented exactly as described — do not fabricate `ready`
  data from `enabled: true` config entries.
- Do not add create/update/delete/reload endpoints, authentication, Git
  inspection, or any capability beyond the two read-only listing/status
  responses and the two health endpoints reserved by §4.2 of
  `docs/SPECIFICATION.md`.
- Do not add background polling, WebSockets, or Server-Sent Events for status
  refresh — the project decided one-shot load + manual retry for v1.

## Architecture and interfaces

### Server: sanitized listing endpoint

Add a small route module, e.g. `src/routes/applications.ts`, exporting a
function that builds an Express router from a `ConfigService`:

```ts
export interface ApplicationListingEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly basePath: string;
  readonly state: "disabled" | "unavailable";
  readonly statusSummary: string;
}

export function createApplicationsRouter(configService: ConfigService): Router;
```

- `GET /api/applications` maps each `ApplicationConfiguration` to an
  `ApplicationListingEntry`:
  - `state`/`statusSummary` from the disabled/unavailable mapping above.
  - `basePath` reused as-is (`/${slug}/`, already public-safe).
  - Explicitly construct the response object field-by-field (never spread the
    internal `ApplicationConfiguration`) so a future internal field addition
    cannot leak through silently.
  - Sort by `sortOrder` ascending (entries without `sortOrder` sort after
    those with one), then by `displayName`, matching the schema's documented
    intent ("sortOrder used before display-name ordering").
  - Respond with `Content-Type: application/json`, `Cache-Control: no-store`
    (status data must not be cached client-side or by intermediaries).
- Mount the router in `src/app.ts` under `/api`, after `app.locals` is set.

### Server: health and readiness

Add `src/routes/health.ts`:

- `GET /health` → `200 { "status": "ok" }` always, once the listener accepts
  requests (Express only serves requests after `listen`, so reachability
  itself proves liveness — no extra internal check needed).
- `GET /ready` → `200 { "status": "ready" }`. Because `ConfigService.load()`
  already runs to completion (with validation) before `startServer` creates
  the listener, readiness is true by construction once the process is
  reachable. Keep the handler trivial but named distinctly from `/health` so
  future phases (adapter initialization reconciliation) have a clear place to
  add real per-request readiness logic without a breaking route change.
- Both endpoints return no configuration, path, or environment detail — just
  the status literal.

### Frontend: HTTP data source

Add `dashboard/src/httpDataSource.ts`:

```ts
export class HttpDashboardDataSource implements DashboardDataSource {
  async listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]> {
    const response = await fetch("/api/applications", { signal });
    if (!response.ok) {
      throw new Error(`Application listing request failed with status ${response.status}.`);
    }
    const payload: unknown = await response.json();
    return parseApplicationListing(payload); // validates shape, freezes result
  }
}
```

- Validate the response shape defensively (array of objects with the expected
  string fields and a known `state` value) before trusting it, and throw on a
  malformed payload so the existing error path handles it uniformly.
- `dashboard/src/main.tsx` uses `HttpDashboardDataSource` unconditionally in
  the built app; remove the `selectFixtureScenario`/`createFixtureDataSource`
  wiring from the production entry point. `fixtures.ts` remains for direct
  import in tests only (`App.test.tsx` already imports
  `FixtureDashboardDataSource` directly, so this needs no test rewiring).

### Frontend: manual retry

- Extend `useApplications` (`dashboard/src/useApplications.ts`) to return a
  `retry(): void` action alongside `applications`/`error`, implemented by
  bumping an internal counter used as an effect dependency (re-running the
  same abort-aware load path already present) rather than duplicating fetch
  logic.
- In `App.tsx`'s `ApplicationCollection` error branch (`applications.length
  === 0 && error`), add a visible "Retry" `<button>` wired to the new
  `retry()` action. Keep the existing calm, non-alarming empty-state framing;
  the retry button is the only new interactive element in that state.

## User experience specification

- Loading, empty, ready-card, degraded-card, and unavailable-card visual
  treatments are unchanged from Phase 2 — only the data source and the
  reachable state set change (`ready`/`degraded`/`initializing`/`stopping`
  are not emitted by the server in Phase 3, so those card treatments simply
  go unused until Phase 4, without being removed from the view-model or CSS).
- The failure state gains exactly one new control: a "Retry" button, focusable
  and reachable by keyboard, with a clear accessible name (e.g. "Retry loading
  applications"). Activating it re-attempts the load and returns to the
  loading skeleton presentation while in flight.
- No application card becomes clickable in this phase — that remains gated on
  Phase 4's real hosted routes, per `docs/SPECIFICATION.md` §8.

## Implementation sequence

1. Add `ApplicationListingEntry` mapping and `createApplicationsRouter` in
   `src/routes/applications.ts`; mount it under `/api` in `src/app.ts`.
2. Add `src/routes/health.ts` with `/health` and `/ready`; mount both in
   `src/app.ts`.
3. Add server integration tests proving: sanitized fields only (assert
   `repoPath`/`adapterPath`/etc. are absent from the raw JSON, not just
   unused), correct disabled/unavailable mapping and summaries, sort order,
   `no-store` caching header, and `200` responses with minimal bodies from
   `/health` and `/ready`.
4. Add `dashboard/src/httpDataSource.ts` with response validation and unit
   tests (success, non-2xx, malformed JSON, network failure, abort).
5. Extend `useApplications` with a `retry()` action; update its existing unit
   tests plus add a retry-specific test (fails once, retry recovers).
6. Add the Retry button to `App.tsx`'s error branch; update `App.test.tsx`'s
   existing failure test to also assert the retry control appears and that
   clicking it re-invokes the data source and can recover to the mixed list
   in a test double.
7. Rewire `main.tsx` to use `HttpDashboardDataSource` in production; remove
   the `?fixture=` selection from the production entry point.
8. Run `npm run typecheck`, `npm test`, `npm run build`.
9. Manually verify against a real `npm start`: confirm `/api/applications`
   output for the current local `config/homebase.json`, confirm no
   private fields appear, confirm `/health` and `/ready` respond `200`, and
   confirm the dashboard's retry path recovers after briefly stopping and
   restarting the server.
10. Update `README.md`: remove the `?fixture=` preview-URL section, document
    `GET /api/applications`, `GET /health`, `GET /ready` briefly, and state
    that application status is now real configuration-derived data (still
    not real process health, pending Phase 4).
11. Update `docs/SPECIFICATION.md` §4.2 only to fix down the previously
    "exact URLs...will be fixed by the implementation plan" language to the
    concrete routes above, and note the Phase 3 disabled/unavailable-only
    status constraint near §6's state table, per §9's "may refine undecided
    implementation details" allowance.
12. Update `docs/TASKS.md`: link this plan from Phase 3, check off completed
    items as their evidence passes, and mark Phase 3 `Done` only once the
    full acceptance gate (contract tests + frontend integration tests +
    sanitization proof) passes.

## Test and acceptance plan

### Automated tests

- Server: `GET /api/applications` against a test `ConfigService` fixture with
  at least one enabled and one disabled application — assert exact JSON
  shape, absence of private fields, sort order, and headers. `GET /health`
  and `GET /ready` return `200` with minimal bodies.
- Frontend: `HttpDashboardDataSource` unit tests covering success, HTTP
  error, malformed payload, network failure, and abort-during-fetch.
  `useApplications` retry test. `App.tsx` test asserting the retry button
  appears only in the failure state, is keyboard-operable, and a successful
  retry replaces the failure heading with the application list.
- Extend the existing `axe-core` sweep to include the failure/retry state.
- `npm run typecheck`, `npm test`, `npm run build` all pass; no regression in
  the Phase 1 configuration test suite (untouched by this plan).

### Manual verification

- `npm run build && npm start` against the local ignored
  `config/homebase.json`; open `/`, confirm real applications render with the
  correct disabled/unavailable split matching that file's `enabled` flags.
- Inspect the raw `/api/applications` response in browser dev tools; confirm
  no `repoPath`, `adapterPath`, or absolute filesystem path appears anywhere
  in the payload.
- Stop the server, reload the page, confirm the failure state and its Retry
  button appear; restart the server, click Retry, confirm the list loads.
- Confirm `/health` and `/ready` both return `200` via direct request.

## Deployment, rollback, and assumptions

- No data migration; no registry/schema change (all new routes use slugs
  already reserved by `ConfigService`).
- Rollback removes the new route modules, the `HttpDashboardDataSource` wiring
  in `main.tsx` (reverting to fixture wiring), and the retry addition in
  `App.tsx`/`useApplications.ts`; `fixtures.ts` and its tests are unaffected
  either way since they remain in the tree as test infrastructure.
- Assumes the hero/responsive plan
  ([2026-08-15-dashboard-hero-and-responsive-refinement.md](2026-08-15-dashboard-hero-and-responsive-refinement.md))
  has already landed, so this plan's `App.tsx` edits apply cleanly against the
  trimmed hero markup rather than the original verbose version.
- Assumes the current local `config/homebase.json` (ignored, developer-owned)
  remains a safe non-secret local file for manual verification; no production
  secrets are introduced by this plan.

## Implementation record

Implemented on 2026-08-16:

- Found the hero/responsive-trim dependency was not actually satisfied: the
  prior commit deleted the entire `.introduction` section (including the
  `h1`) from `App.tsx` instead of trimming it to the compact version its own
  plan specified, leaving `App.test.tsx` failing on a clean checkout. Restored
  the `h1`/`.prototype-notice` markup exactly as that plan's example
  specified before starting Phase 3 work, since Phase 3 explicitly depends on
  a finished Phase 2 UI.
- `src/routes/applications.ts`: `createApplicationsRouter` maps each
  `ApplicationConfiguration` field-by-field to an `ApplicationListingEntry`
  (`disabled`/`unavailable` only, per the status-honesty constraint), sorted
  by `sortOrder` (undefined last) then `displayName`, with
  `Cache-Control: no-store`.
- `src/routes/health.ts`: trivial `GET /health` / `GET /ready` returning
  `{ status: "ok" }` / `{ status: "ready" }`.
- `src/app.ts`: mounts both routers (applications under `/api`) ahead of
  dashboard hosting.
- `test/routes/applications.test.ts` and `test/routes/health.test.ts`: assert
  exact sanitized JSON shape, absence of private fields (including the raw
  workspace path) anywhere in the response text, sort order, and headers.
- `dashboard/src/httpDataSource.ts`: `HttpDashboardDataSource` fetches
  `/api/applications`, defensively validates shape/known `state` values, and
  freezes the result; unit tests cover success, non-2xx, malformed payload,
  network failure, and abort.
- `dashboard/src/useApplications.ts`: added a `retry()` action (bumps an
  attempt counter that re-runs the existing abort-aware load effect).
- `dashboard/src/App.tsx`: added a "Retry loading applications" button to the
  failure branch of `ApplicationCollection`, wired to `retry()`.
  `App.test.tsx` extended to cover keyboard-reachability, a failing-then-
  recovering retry flow, and an axe-core sweep of the failure/retry state.
- `dashboard/src/main.tsx`: now renders `HttpDashboardDataSource`
  unconditionally; removed the `?fixture=` production wiring.
  `dashboard/src/fixtures.ts`/`fixtures.test.ts` are unchanged and remain as
  direct-import test infrastructure only.
- Commands: `npm run typecheck`, `npm test` (8 files, 87 tests), and
  `npm run build` all passed.
- Manual verification: ran `npm run build && npm start` against the local
  `config/homebase.json` (all four sample applications `enabled: false`).
  Confirmed `GET /api/applications` returns all four as `disabled` with the
  expected sanitized shape and `Cache-Control: no-store`; confirmed
  `repoPath`/`repositoryRoot`/`adapterPath`/`adapterFile` and the raw
  workspace path never appear in the response; confirmed `GET /health` and
  `GET /ready` both return `200` with minimal bodies and no path/config
  detail. Did not have an interactive GUI browser available in this session,
  so the dashboard's rendered retry-recovery flow was verified through the
  automated `App.test.tsx` retry test (fails once, then a successful retry
  replaces the failure heading with the rendered list) rather than a live
  stop/restart browser session; a human spot-check of that flow in a real
  browser is a reasonable follow-up before Phase 4 work begins.
- `README.md` and `docs/SPECIFICATION.md` §4.2/§6 updated per the
  implementation sequence; `docs/TASKS.md` Phase 3 checked off and marked
  `Done`.
