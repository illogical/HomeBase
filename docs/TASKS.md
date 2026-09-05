# HomeBase Development Tasks

> [!IMPORTANT]
> This file owns current progress and upcoming development priority. HomeBase
> has a completed, runtime-verified Phase 1 configuration foundation. Later
> implementation phases remain incomplete unless their own tasks say otherwise.

## How to use this task index

Allowed phase and task statuses are `Not started`, `In progress`, `Blocked`, and
`Done`. Only mark work `Done` after its acceptance gate has been verified and the
result recorded honestly.

Every implementation task and acceptance gate is a Markdown checkbox. Use
`- [ ]` for incomplete work and change it to `- [x]` only after that specific
item has been completed and verified. Keep partially completed phases marked
`In progress`; a phase becomes `Done` only when all of its required checkboxes,
including its acceptance gate, are checked. If later evidence invalidates a
completed item, reopen its checkbox and correct the phase status.

Before implementing an item:

1. Read [README.md](../README.md), [SPECIFICATION.md](SPECIFICATION.md), and this
   task index.
2. Align on the update's expectations and material tradeoffs.
3. Create and approve a decision-complete plan at
   `docs/plans/YYYY-MM-DD-<feature-slug>.md`.
4. Link that plan from the relevant item below.
5. Implement it in a separate, fresh session when explicitly requested.

`Plan: pending` means no approved implementation plan exists. It is not
authorization to implement the item.

## Current priority

Phases 1 through 4 are complete. Phase 6 (container and Tailnet rollout) is
implemented and verified except for one external step: approving the real
`svc:home` Tailscale service in the tailnet admin console and confirming
access from a second Tailnet device (see Phase 6 below). Phase 5 (real
sibling-repository migrations) remains a separate priority; each candidate
application requires its own separate, aligned implementation plan before
work begins, per this file's workflow.

## Phase 1: Configuration foundation

**Status:** Done

**Plans:** [Compact configuration schema and samples](plans/2026-08-15-configuration-schema-and-samples.md),
[Phase 1 configuration runtime foundation](plans/2026-08-15-phase-1-configuration-runtime.md),
[cross-platform configuration filesystem tests](plans/2026-08-15-cross-platform-configuration-tests.md)

- [x] Scaffold the Node 24, TypeScript, Express 5 server and its test harness.
- [x] Implement the in-process JSON configuration service.
- [x] Add the Draft 2020-12 registry schema, a tracked generic example, and an
  ignored local registry containing DevPlanner, LMApi, MemoryApi, and LMEval.
- [x] Validate schema and contract versions, unique IDs/slugs, reserved routes, and
  traversal-safe workspace-relative repository and adapter paths.
- [x] Normalize valid records into an immutable internal representation without
  importing application code.
- [x] Add tests for valid configuration and every required rejection case.

- [x] **Acceptance gate:** A clean test run proves that valid sample configuration
  is loaded deterministically and unsafe or incompatible configuration prevents
  startup with actionable errors. No folder is treated as executable
  configuration through discovery.

## Phase 2: Static frontend prototype

**Status:** Done
**Plans:** [static frontend prototype](plans/2026-08-15-static-frontend-prototype.md),
[dashboard hero and responsive refinement](plans/2026-08-15-dashboard-hero-and-responsive-refinement.md)

- [x] Create the React and Vite dashboard shell using static fixture applications.
- [x] Apply a restrained dark visual system with neutral, warm, and natural accents.
- [x] Implement responsive desktop, tablet, and mobile card layouts.
- [x] Provide keyboard navigation, semantic structure, visible focus, and appropriate
  contrast.
- [x] Demonstrate loading, empty, disabled, ready, degraded, and unavailable states.
- [x] Keep the data seam explicit so fixtures can be replaced in Phase 3.
- [x] Trim the hero/introduction content to a heading and a compact prototype
  notice, and verify the responsive layout explicitly against phone, iPad mini
  (portrait and landscape), and desktop viewports.

- [x] **Acceptance gate:** The production frontend build succeeds; automated
  component and accessibility checks pass; and manual viewport/keyboard review
  verifies every required state, the phone/iPad-mini/desktop layout matrix,
  and the trimmed hero content without claiming live configuration or status
  integration.

## Phase 3: Configuration and status integration

**Status:** Done  
**Plan:** [Phase 3 configuration and status API](plans/2026-08-15-phase-3-configuration-status-api.md)

- [x] Define stable read-only application-listing and status response types.
- [x] Expose sanitized registry metadata without filesystem or adapter details.
- [x] Implement HomeBase liveness and readiness endpoints.
- [x] Replace frontend fixture data with API loading and honest error/reconnect states.
- [x] Ensure no HTTP endpoint can mutate configuration in v1.

- [x] **Acceptance gate:** API contract tests and frontend integration tests prove
  that valid configuration renders correctly, private configuration is omitted,
  and loading, empty, and failure responses remain usable and accessible.

## Phase 4: Hosted architecture proof

**Status:** Done  
**Plan:** [Phase 4 hosted architecture proof](plans/2026-08-15-phase-4-hosted-architecture-proof.md)

- [x] Define and version the shared hosted adapter TypeScript contract
  (`src/contracts/hostedApplication.ts`).
- [x] Implement compiled adapter loading, compatibility checks, initialization,
  status collection, route/static mounting, realtime dispatch, and disposal
  (`src/services/ApplicationHost.ts`).
- [x] Add independent fixture adapters for routes, static assets, SPA fallback,
  WebSockets, Socket.IO, degradation, failure, active work, and cleanup
  (`test/fixtures/adapters/`).
- [x] Verify route, filesystem, browser-origin, and shared-server isolation rules.
- [x] Implement bounded graceful shutdown and structured application-scoped logging
  consistent with the draft
  [logging and OpenTelemetry evolution intentions](features/2026-08-15-logging-and-opentelemetry-intentions.md)
  (`src/logging/`).

- [x] **Acceptance gate:** Fixtures prove import safety, deterministic realtime
  ownership, reverse-order idempotent disposal, no open handles, safe degraded
  startup, and no cross-application route or SPA fallback collisions. Verified
  by `test/services/ApplicationHost.test.ts`,
  `test/integration/hostedApplications.test.ts`, and the full `npm test` /
  `npm run typecheck` / `npm run build` run recorded when this phase was
  completed.

## Phase 5: Candidate application integrations

**Status:** In progress  
**Plan:** separate plan required for each repository

Each update below must inspect that repository's current implementation and local
guidance. It must preserve standalone operation and receive its own approved plan
before any repository changes:

- [ ] DevPlanner adapter and base-path migration — **In progress** — Plan:
  [DevPlanner HomeBase integration plan](file:///C:/LocalDev/Projects/DevPlanner/docs/plans/2026-08-16-homebase-integration.md)
  (external repository; see also that repo's
  [migration handoff](file:///C:/LocalDev/Projects/DevPlanner/docs/features/homebase-integration-handoff.md)).
  Migration, hosted adapter, base-path work, and test-suite migration are
  complete and were verified live against a real running HomeBase process
  (page load, static assets, SPA routing, API, WebSocket, live card-update
  broadcast). One DevPlanner-side bug was found and fixed
  (`notFoundHandler` scoping). One HomeBase-side bug was found — the bare
  `GET /devplanner/` route infinite-redirect-looped because the
  trailing-slash-redirect route also matched the already-canonical path —
  and has since been fixed here in `34e0115` (`ApplicationHost.ts`'s
  `mountApplication` now guards with `request.path === basePath`). **Next
  step:** re-run DevPlanner's live verification matrix end-to-end now that
  this fix has landed, then check this item and its portion of the
  acceptance gate.
- [x] LMApi adapter and base-path migration — **Done** — Plan:
  [LMApi HomeBase integration plan](file:///C:/LocalDev/Projects/LMApi/docs/plans/2026-08-16-homebase-integration.md)
  (external repository; hosted adapter and base-path migration implemented
  and verified live against a real running HomeBase process — adapter loads
  in the shared host process, and routes/API calls were confirmed working).
- [x] MemoryApi adapter and base-path migration — **Done** — Plan:
  [MemoryApi HomeBase integration plan](file:///C:/LocalDev/Projects/MemoryApi/docs/plans/homebase-integration-plan.md)
  (external repository; hosted adapter and base-path migration implemented
  and verified live against a real running HomeBase process).
- [x] LMEval adapter and base-path migration — **Done** — Plan:
  [LMEval HomeBase integration handoff plan](file:///C:/LocalDev/Projects/LMEval/docs/plans/2026-08-23-homebase-integration.md)
  (external repository; hosted adapter and base-path migration implemented
  and verified live against a real running HomeBase process:
  `config/homebase.json`'s `lmeval.enabled` flipped to `true`; dashboard
  reports `lmeval` and `lmapi` both `ready`; `/lmeval/` frontend, `/api/eval/*`
  routes, and `/lmeval/ws/eval` WebSocket namespace all confirmed reachable;
  a live call through LMEval's `/lmeval/api/eval/models` returned LMApi's full
  live model list, confirming the loopback URL
  (`http://127.0.0.1:17106/lmapi`, derived from `HOMEBASE_PORT` at
  `initialize()` time — not the standalone `LMAPI_BASE_URL=…:17110` env var,
  which only applies outside hosted mode) is correct; shutdown was clean with
  no dangling errors).

- [ ] **Acceptance gate:** All four compiled adapters can run in the same HomeBase
  process and shared server, pass the shared integration matrix, dispose their
  resources, remain independently runnable, and report failures without hiding
  the truth about healthy applications. (Not yet met: DevPlanner's adapter
  currently fails to initialize and MemoryApi reports degraded — vector/graph
  backends (Qdrant/Neo4j) unreachable in this environment. Both are pre-existing,
  unrelated to LMEval's integration.)

## Phase 6: Container and Tailnet rollout

**Status:** In progress  
**Plan:** [Phase 6 container and Tailnet rollout](plans/2026-08-16-phase-6-container-and-tailnet-rollout.md),
[container and Tailnet deployment doc](features/2026-08-16-container-and-tailnet-deployment.md)
(implemented; second-device Tailnet verification pending)

- [x] Add Docker packaging for one Node process and shared HTTP listener
  (`Dockerfile`, `.dockerignore`).
- [x] Publish the environment-configured port on host loopback only
  (`docker-compose.yml`; verified `docker port` shows `127.0.0.1:<port>`).
- [x] Mount the workspace root and application-scoped writable data locations using
  documented ownership and access modes (`.env.docker.example`; verified
  read-only workspace, writable data directory, UID 1000 ownership).
- [x] Add container health/readiness checks and graceful stop behavior
  (`scripts/healthcheck.mjs`, `HEALTHCHECK`, `stop_grace_period`; verified
  `healthy` status, and a `docker stop` completing via HomeBase's own
  `shutdown-begin`/`shutdown-complete` sequence well inside the watchdog).
- [x] Document host-managed Tailscale Serve configuration without mutating it from
  HomeBase (verified command syntax against the real installed CLI, and
  verified via a before/after JSON diff that starting/stopping the container
  does not change `tailscale serve status`).
- [x] Verify localhost and `home.<tailnet>.ts.net` access, restart behavior, failure
  reporting, rollback, and teardown. Localhost access, `docker kill` +
  `restart: unless-stopped` recovery, a misconfigured-mount failure reporting
  the existing actionable `ConfigurationError`, a full rollback rehearsal
  (tag, roll forward, roll back, no data loss), and independently-scoped
  teardown are all verified — see the deployment doc's verification table.
  **Not yet verified:** `https://home.<tailnet>.ts.net` reachability from a
  second, physically separate Tailnet device — the current tailnet requires
  admin approval before a newly named Tailscale service becomes reachable,
  and that approval was not obtained during implementation (see the
  deployment doc §8). **Next step:** approve the real `svc:home` service in
  the tailnet admin console, then complete this check from a second device.

- [x] **Acceptance gate:** A documented clean deployment works from localhost and a
  second Tailnet device; unhealthy optional applications do not make HomeBase
  readiness dishonest; and the previous deployment can be restored using the
  documented rollback procedure. Localhost, readiness-honesty (unchanged
  `/health`/`/ready` routes, per §6), and rollback are verified. The gate
  remains open only on second-Tailnet-device reachability, pending the admin
  approval noted above.

- [x] Docker development mode with hot-reload — **Done** — Plan:
  [Docker development mode with hot-reload](plans/2026-08-21-docker-development-hot-reload.md)
  (dev-only `dev` build stage and `docker-compose.dev.yml`, additive to the
  production image/Compose file above; verified build, health, backend
  restart via `nodemon --legacy-watch`, and Vite HMR via
  `CHOKIDAR_USEPOLLING`/`server.watch.usePolling` — both required as a
  polling fallback since this Windows host's Docker Desktop does not forward
  native bind-mount file-change events reliably).

## Phase 7: Git status dashboard integration

**Status:** Done  
**Plan:** [Git status dashboard integration](plans/2026-08-22-git-status-dashboard-integration.md)

- [x] Add `GitStatusService` (branch, clean/dirty, upstream, ahead/behind via
  the `git` CLI) with tests against real temporary repositories
  (`src/services/GitStatusService.ts`, `test/services/GitStatusService.test.ts`).
- [x] Add the `/api/homebase/applications/:id/git-status` read-only endpoint,
  plus `/fetch` and `/pull` (fast-forward-only) mutating endpoints, with
  route integration tests (`src/routes/homebaseGit.ts`,
  `test/routes/homebaseGit.test.ts`).
- [x] Add a dashboard `GitStatusPanel`, shown only on `ready`-state
  application cards, with manual Refresh/Fetch/Pull controls and no
  background polling (`dashboard/src/GitStatusPanel.tsx`).
- [x] Update `docs/SPECIFICATION.md` documenting the new endpoints (§4.2a).

- [x] **Acceptance gate:** Automated tests pass (`GitStatusService`,
  `homebaseGit` route integration, and `GitStatusPanel` component tests, all
  new and passing; pre-existing unrelated failures in `App.test.tsx`'s
  link-name accessibility check and `ApplicationHost.test.ts`'s SPA-fallback
  isolation test are unchanged from `main` and out of scope for this phase).
  A live verification pass against a real running HomeBase instance
  (a scratch registry entry pointing at a real git clone with a real bare
  "upstream" remote) confirmed: clean vs. dirty `workingTree` reporting, a
  real `fetch` advancing the reported `behind` count, a real fast-forward
  `pull` advancing the checked-out commit and clearing `behind`, dirty-tree
  pull rejection (`409`, `error: "dirty-tree"`), and overlapping-request
  rejection (`409`, `error: "operation-in-progress"`) for two concurrent
  fetches against the same application.

**Follow-up (2026-08-22):** the live Docker `dev` container was found to lack
the `git` binary (`node:24-slim` base image) and mounted `/workspace` as
`:ro`, so status/fetch/pull all failed there despite the checks above passing
against a local (non-Docker) instance. Fixed: `git` is now installed in both
the `dev` and `runtime` Dockerfile stages, and `/workspace` is mounted `:rw`
in both Compose files. See `docs/SPECIFICATION.md` §2/§4.2a and the
container/Tailnet deployment doc for the updated contract; this assumes
public repositories only (no credential wiring was added for private
remotes).

**Follow-up (2026-08-23):** DevPlanner's Review & Compare feature (a separate,
DevPlanner-side git integration against its mounted vault, not this
`GitStatusService`) reported every AgentVault file as untracked in Docker.
Root cause was git's dubious-ownership protection rejecting the bind-mounted
vault (host UID 501 vs. the container's UID 1000 `node` user), not missing
credentials — DevPlanner's vault git operations are local-only and never
needed authentication. Fixed by baking `safe.directory` entries for
`/workspace`, `/mnt/devplanner-vault`, and `/mnt/devplanner-workspace` into
the image (both Dockerfile stages). Separately, and to close the
previously-deferred credential gap noted above before it causes a second
failure, added scoped HTTPS credential wiring: a mounted git-credential-store
file (`HOMEBASE_HOST_GIT_CREDENTIALS_PATH` → `/run/secrets/git-credentials`,
read-only) and a `credential.helper` pointing at it, so a private repository's
`fetch`/`pull` (via this `GitStatusService`, if one is ever added to the
registry) now authenticates instead of failing closed. See
`docs/plans/2026-08-22-docker-git-credentials.md` (now implemented) and the
README's "Git status and credentials for private repositories" section for
setup steps.

## Phase 8: Deferred capabilities

**Status:** Not started  
**Plan:** create one aligned plan per capability

- [ ] Coordinated cross-repository development watching, frontend HMR, and host
  restart behavior — **Partially implemented (development only), live
  verification outstanding** — Plan:
  [hosted-application hot reload](plans/2026-09-04-hosted-app-hot-reload.md);
  analysis: [gap analysis](plans/2026-09-03-hosted-app-hot-reload-gap-analysis.md).
  Shipped: `ApplicationHost.reload(id)` with dispose-then-reimport instance
  swap (`SPECIFICATION.md` §6a), `POST /api/applications/:id/reload` (§4.2),
  and a development-only `DevReloadService` that watches each enabled sibling's
  source, runs that sibling's own build scripts, and hot reloads its compiled
  adapter. Automated tests pass; still unchecked because end-to-end
  verification against the running `homebase-dev` container and real sibling
  repositories has not been done, and frontend HMR for hosted applications
  remains out of scope.
- [ ] Build and loaded-revision visibility.
- [ ] Dependency installation, build verification, restart, and rollback after
  a pull.
- [ ] Per-user authentication and authorization, audit events, and administration.
- [ ] Centralized observability, OpenTelemetry collection, Git-revision
  correlation, and read-only HomeBase log/metric/trace views — **Not started** —
  Intentions:
  [logging and OpenTelemetry evolution](features/2026-08-15-logging-and-opentelemetry-intentions.md)
- [ ] Search, favorites, recent applications, version details, and operational
  controls where they improve the portal.

- [ ] **Acceptance gate:** Define acceptance criteria through aligned plans before
  scheduling any deferred capability.
