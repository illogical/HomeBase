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

Phases 1 through 4 are complete. Phase 5 (real sibling-repository migrations)
is the next priority; each candidate application requires its own separate,
aligned implementation plan before work begins, per this file's workflow.

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

**Status:** Not started  
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
- [ ] LMApi adapter and base-path migration — **Not started** — Plan:
  [LMApi HomeBase integration plan](file:///C:/LocalDev/Projects/LMApi/docs/plans/2026-08-16-homebase-integration.md)
  (external repository; phased plan approved, implementation not yet begun).
- [ ] MemoryApi adapter and base-path migration — **Not started** — Plan: pending
- [ ] LMEval adapter and base-path migration — **Not started** — Plan: pending

- [ ] **Acceptance gate:** All four compiled adapters can run in the same HomeBase
  process and shared server, pass the shared integration matrix, dispose their
  resources, remain independently runnable, and report failures without hiding
  the truth about healthy applications.

## Phase 6: Container and Tailnet rollout

**Status:** Not started  
**Plan:** [Phase 6 container and Tailnet rollout](plans/2026-08-16-phase-6-container-and-tailnet-rollout.md)
(Draft; approval pending)

- [ ] Add Docker packaging for one Node process and shared HTTP listener.
- [ ] Publish the environment-configured port on host loopback only.
- [ ] Mount the workspace root and application-scoped writable data locations using
  documented ownership and access modes.
- [ ] Add container health/readiness checks and graceful stop behavior.
- [ ] Document host-managed Tailscale Serve configuration without mutating it from
  HomeBase.
- [ ] Verify localhost and `home.<tailnet>.ts.net` access, restart behavior, failure
  reporting, rollback, and teardown.

- [ ] **Acceptance gate:** A documented clean deployment works from localhost and a
  second Tailnet device; unhealthy optional applications do not make HomeBase
  readiness dishonest; and the previous deployment can be restored using the
  documented rollback procedure.

## Phase 7: Deferred capabilities

**Status:** Not started  
**Plan:** create one aligned plan per capability

- [ ] Coordinated cross-repository development watching, frontend HMR, and host
  restart behavior.
- [ ] Read-only Git checkout, upstream, build, and loaded-revision visibility.
- [ ] Git pull, dependency installation, build verification, restart, and rollback.
- [ ] Per-user authentication and authorization, audit events, and administration.
- [ ] Centralized observability, OpenTelemetry collection, Git-revision
  correlation, and read-only HomeBase log/metric/trace views — **Not started** —
  Intentions:
  [logging and OpenTelemetry evolution](features/2026-08-15-logging-and-opentelemetry-intentions.md)
- [ ] Search, favorites, recent applications, version details, and operational
  controls where they improve the portal.

- [ ] **Acceptance gate:** Define acceptance criteria through aligned plans before
  scheduling any deferred capability.
