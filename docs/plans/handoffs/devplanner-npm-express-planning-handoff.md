# DevPlanner npm and Express Planning Handoff

**Handoff status:** Ready to begin discovery and alignment  
**Target repository:** DevPlanner  
**Requested outcome:** A decision-complete DevPlanner implementation plan, not implementation

## Purpose

Use this handoff to start a planning session from a coding assistant that has
access to the current DevPlanner source code. The planning goal is to determine
how DevPlanner should migrate or refactor to Node.js 24, npm, and Express 5 while
remaining independently usable and becoming composable inside HomeBase.

Do not implement the migration during this session. Inspect DevPlanner, align
material decisions with the user, and write the plan in the DevPlanner repository
according to that repository's own guidance. Keep it `Draft` until the open
product and architecture decisions have been resolved and the user approves it.

## Start here

1. Read DevPlanner's repository-wide and directory-specific agent instructions.
2. Read its README, specification, task index, architecture records, and existing
   migration plans, if present.
3. Inspect the current worktree and preserve unrelated changes.
4. Establish the current baseline from source, manifests, lockfiles, scripts,
   build configuration, tests, and generated output. Do not rely on the historical
   observations below as current facts.
5. Compare the live implementation with the HomeBase requirements in this
   handoff.
6. Ask only the questions whose answers materially change scope, architecture,
   compatibility, or acceptance criteria.
7. Produce a decision-complete plan for a fresh implementation session.

## HomeBase intent

HomeBase is planned as one Node.js 24 process containing one Express 5
application and one shared `http.Server`. It will load trusted applications from
independent repositories through compiled, import-safe hosted adapters. DevPlanner
is expected to be available beneath `/devplanner/` while continuing to support
standalone development, build, test, and start workflows from its own repository.

This is composition, not a monorepo migration. DevPlanner retains its own
`package.json`, `package-lock.json`, dependencies, tests, and build output.
HomeBase must not install DevPlanner dependencies at runtime or start DevPlanner
as a hidden HTTP child process.

HomeBase is currently documentation-only. Its exact shared TypeScript package,
concrete adapter types, lifecycle timeouts, and final registry artifacts have not
yet been implemented. The DevPlanner plan should identify any sequencing or
contract dependency instead of inventing those details locally.

## Approved compatibility requirements

The plan must preserve or establish all of the following:

- Node.js 24, npm, TypeScript, Express 5, React, and Vite compatibility.
- Clean, reproducible npm installation with an authoritative lockfile.
- Standalone DevPlanner install, development, test, build, and start workflows.
- A compiled JavaScript hosted entry point that HomeBase can load without
  importing DevPlanner's TypeScript source tree.
- An Express router that can be mounted beneath the supplied application base
  path without creating another listener.
- Explicit lifecycle control for initialization, status, realtime attachment,
  active-work reporting when applicable, and idempotent disposal.
- Explicitly injected repository, application data, configuration, public URL,
  and logging inputs rather than assumptions based on the current working
  directory or shared mutable environment variables.
- Honest `ready`, `degraded`, and `unavailable` behavior when optional or required
  DevPlanner dependencies fail.
- Structured, sanitized application-scoped logging without secrets, raw
  environment values, stack traces in public responses, or misleading status.

The hosted adapter contract is not yet a finalized TypeScript API, but its v1
behavior is expected to be equivalent to:

```ts
interface HostedApplication {
  contractVersion: 1;
  initialize?(): Promise<void>;
  router?: Express.Router;
  staticAssets?: {
    directory: string;
    spaFallback: boolean;
  };
  attachRealtime?(server: http.Server): Promise<Disposer | void>;
  getStatus(): Promise<HostedApplicationStatus>;
  getActiveWork?(): Promise<ActiveWorkStatus>;
  dispose?(): Promise<void>;
}
```

Creation options are expected to supply the application ID, repository root,
web/API/realtime base paths, host origin, application-scoped writable data path,
application-specific configuration, and scoped logger. The plan should map
DevPlanner's actual needs to those inputs and flag any missing HomeBase contract
capability.

## Import-safety boundary

Merely importing the compiled adapter must not:

- listen on a port or attach handlers to a server;
- open databases, connect to external services, or start MCP transports;
- create or modify files;
- start watchers, timers, queues, refresh loops, or background work;
- install signal or process-level error handlers;
- call `process.exit()`;
- change the process working directory; or
- mutate shared environment state.

Initialization may acquire resources only after HomeBase requests it. Partial
initialization must clean up resources already acquired. Disposal must be
idempotent and release all DevPlanner-owned watchers, timers, sockets, file
handles, queues, locks, database handles, and child processes.

Standalone process ownership must be kept outside the import-safe adapter. The
standalone entry point may create the listener and own signals, but should build
on the same application factories and lifecycle components used by the hosted
entry point.

## Routing and shared-origin requirements

HomeBase owns `/`, `/api`, `/assets`, `/health`, and `/ready`. DevPlanner owns
`/devplanner/` and paths nested beneath it. The planning investigation must trace
and account for every server- and browser-generated URL, including:

- Express routes, redirects, forms, downloads, and OpenAPI or documentation;
- Vite base configuration, emitted assets, and development proxy behavior;
- React router bootstrap and direct SPA navigation;
- API clients and dynamically generated links;
- WebSocket endpoints, upgrade matching, reconnect behavior, and broadcasts;
- cookies, browser-storage keys, service workers, and other origin-wide state;
- viewer, editor, and file-serving routes; and
- SPA fallback behavior.

All DevPlanner-owned web, API, asset, download, and realtime paths must remain
beneath its supplied base path when hosted. Its SPA fallback must never consume a
HomeBase or sibling-application route. Shared-origin state must be namespaced,
and a DevPlanner service worker must not control routes outside DevPlanner.

## npm and Express migration investigation

Use the live source to inventory the migration surface before choosing file
changes. At minimum, inspect:

- root and frontend manifests, lockfiles, engines, package-manager metadata,
  scripts, CI, and developer setup;
- all Bun runtime, filesystem, process, test, WebSocket, and shell-script usage;
- Elysia application composition, route factories, middleware, validation,
  error handling, response semantics, and OpenAPI behavior;
- listener creation, signal handling, global error handlers, and import-time
  side effects;
- watchers, history, Git/worktree operations, dispatch processes, backups,
  vault access, prompts, content workspaces, and configuration loading;
- global singletons and resources that need factory ownership and disposal;
- MCP stdio behavior and any `supergateway` or HTTP bridge assumptions;
- frontend type checking, build output, base-path assumptions, HMR, API calls,
  and realtime clients; and
- current unit, integration, end-to-end, and shutdown coverage.

The desired end state has no required Bun dependency in runtime, tests, or npm
scripts, and uses Express 5 for the hosted HTTP router. Preserve independently
runnable MCP stdio behavior where it exists; do not place a stdio transport or a
hidden gateway process inside HomeBase merely to satisfy the one-process web
architecture.

Do not mechanically translate framework syntax. Record the behavior that must
remain compatible, then plan Express middleware, validation, error handling,
OpenAPI, WebSocket, and test equivalents with parity checks.

## Historical leads to verify

An older cross-repository review described DevPlanner as using Bun and Elysia,
with Bun-specific WebSocket, filesystem, process, and test APIs. It also reported
import-time watchers, listening, signal handlers, global services, a stale root
npm lockfile, and frontend TypeScript failures.

These observations may be outdated. Confirm or reject each one from the current
checkout, and record the commands, relevant source locations, and observed
results in the plan's current-state section. Do not repeat an old revision or
test count as current evidence.

## Decisions the planning session must close

Resolve these from source evidence and user alignment:

1. The exact standalone and hosted entry points and how they share factories
   without sharing process ownership.
2. The npm workspace or independent frontend-package arrangement, authoritative
   lockfile strategy, and supported developer commands.
3. The Express routing, validation, error, and OpenAPI compatibility approach.
4. The WebSocket ownership and dispatch model on HomeBase's shared server,
   including deterministic path matching and detachable handlers.
5. The full set of injected paths and configuration, their validation, and which
   data locations require write access.
6. The ownership and cleanup model for watchers, background work, locks, Git and
   worktree commands, dispatch children, and MCP-related processes.
7. The hosted and standalone frontend base-path strategy, including HMR.
8. What `ready`, `degraded`, and `unavailable` mean for DevPlanner, and how active
   work should affect shutdown.
9. Build outputs and package exports for compiled standalone and hosted code.
10. Migration sequencing, compatibility window, rollback boundary, and whether
    any temporary dual-runtime support is justified.
11. The HomeBase contract artifacts that must exist before DevPlanner integration
    can be completed or verified.

If a proposed answer conflicts with an approved DevPlanner contract or the
HomeBase requirements above, stop and surface the conflict. Do not silently pick
one source of truth or expand the project into unrelated cleanup.

## Required plan contents

The resulting DevPlanner plan must be detailed enough for a fresh coding
assistant to implement without making product decisions. Include:

- goal, user-visible success criteria, scope, exclusions, and deferred work;
- verified current-state findings with relevant files and reproducible commands;
- architecture and data-flow decisions for standalone and hosted modes;
- affected interfaces, configuration, schemas, routes, WebSockets, public assets,
  package exports, and build outputs;
- a file-by-file or subsystem-grouped implementation sequence;
- lifecycle, partial-failure, degraded-mode, security, and cleanup behavior;
- automated tests and manual verification with explicit acceptance criteria;
- npm clean-install, type-check, test, build, standalone-start, hosted-import,
  base-path, realtime, and no-open-handle verification;
- development workflow, CI, documentation, migration, monitoring, and rollback
  changes; and
- assumptions, dependencies on unfinished HomeBase work, and deliberately
  deferred items.

Do not mark the plan `Approved` until the user has reviewed its material choices.
Do not mark the HomeBase Phase 5 DevPlanner task complete based on planning or
DevPlanner-only static checks.

## Acceptance matrix the plan must cover

At minimum, plan verification for:

- a clean npm install using the declared Node.js and npm versions;
- frontend and backend type checking;
- unit and integration tests under Node, with no required Bun runner;
- production builds for standalone and compiled hosted entry points;
- standalone development, frontend HMR, production start, and MCP stdio parity;
- side-effect-free adapter import before initialization;
- hosted mounting at `/devplanner/`, including direct SPA routes, APIs, assets,
  redirects, file viewing/editing, downloads, and API documentation;
- deterministic WebSocket upgrades and broadcasts without claiming sibling paths;
- initialization failure and dependency degradation with sanitized status;
- partial-initialization cleanup and repeated idempotent disposal;
- shutdown during active work according to the aligned policy;
- no leftover listener, watcher, timer, socket, lock, child process, or other open
  handle after disposal; and
- integration against the actual shared HomeBase contract and server once those
  artifacts exist.

## HomeBase references

When both repositories are available, use these HomeBase documents in precedence
order after the user's current instructions and DevPlanner's local agent guidance:

1. `README.md`
2. `docs/SPECIFICATION.md`
3. `docs/TASKS.md`, especially Phase 5
4. `docs/BACKGROUND.md` only for historical leads that are revalidated

The HomeBase specification is the approved v1 intent. The background document
is not an implementation commitment and must not override current DevPlanner
source, DevPlanner's approved contracts, or an aligned plan.
