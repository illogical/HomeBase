# Unified Node/Express Portal — Architecture Review and Continuation Plan

> **For Hermes:** Use `subagent-driven-development` to execute this plan repository-by-repository. Before implementing a task, read the corresponding SourceManager document under `docs/features/unified-node-express-portal/` and inspect the authoritative target-machine checkout. Do not treat the reference revisions in this artifact as a substitute for a fresh target-machine precheck.

**Goal:** Continue the existing SourceManager `single-process` work into a verified, reversible rollout where SourceManager owns one Node/Express HTTP server and loads independently runnable sibling projects through compiled host adapters.

**Architecture:** SourceManager remains the composition root and sole hosted HTTP listener. DevPlanner, LMApi, MemoryApi, and LMEval retain standalone npm workflows but additionally export side-effect-free compiled adapters that provide routers, static assets, realtime attachment, lifecycle hooks, and status. One Tailscale Service named `apps` exposes the portal through project-specific URL paths.

**Tech Stack:** Node 24 LTS, npm 11, TypeScript, Express 5, React/Vite, Vitest, `ws`, Socket.IO, independent sibling repositories and package lockfiles.

---

## 1. Relationship to the existing repository plan

### Verdict

The proposed continuation is **architecturally aligned** with the existing plan in SourceManager:

```text
docs/features/unified-node-express-portal/
```

The repository documents remain the detailed architecture and per-project migration source of truth. This AgentVault artifact does not replace or duplicate them. It provides:

1. a concise review of their alignment;
2. corrections from current repository verification;
3. a safer execution order;
4. cross-repository quality gates;
5. rollout and rollback boundaries.

### Existing decisions retained unchanged

The continuation keeps these repository-plan decisions:

- SourceManager is the composition root and sole hosted HTTP listener.
- The host uses Node, npm, TypeScript, Express 5, and one shared `http.Server`.
- Sibling repositories remain independent GitHub projects with their own `package-lock.json` and `node_modules`.
- SourceManager imports compiled JavaScript adapters such as `dist/host/index.js`; it does not ingest sibling TypeScript source trees.
- Hosted adapters never call `listen()`, mutate process-global configuration, install global signal handlers, or exit the process.
- Each adapter supports explicit initialization, status, realtime attachment, and disposal.
- SourceManager owns bounded static mounting and project-specific SPA fallbacks.
- Web, API, and realtime paths are namespaced by project.
- Adapter load failures isolate the affected project where possible.
- Updates use pull → install if required → build → verify → graceful whole-host restart.
- General in-process hot replacement is rejected as unsafe.
- Standalone `npm run dev`, `npm run build`, `npm start`, and `npm test` remain required.
- One global Tailscale Service named `apps` targets SourceManager.
- Project status distinguishes checked-out, built, and loaded commits.

### Continuation adjustments

The following refinements should be applied to the existing task list and migration documents before or during implementation:

1. **Migration order:** migrate DevPlanner first, then LMApi, MemoryApi, and LMEval.
2. **Baseline refresh:** the migration documents' LMApi and LMEval inspected revisions do not match current public `main`; refresh their current-state sections before coding.
3. **Package reproducibility first:** repair `npm ci`, compiled startup, frontend builds, and backend type-checking before adding host adapters.
4. **v1 deletion gate:** do not treat removed process-management code on the experimental branch as an approved production deletion. Production v1 remains the rollback system until all acceptance gates pass.
5. **Git/update parity:** project-level Git pull/build/verify/restart must return before v2 can replace SourceManager's original deployment purpose.
6. **Discovery boundary:** workspace folder scanning may suggest candidate projects, but explicit validated configuration remains authoritative for code loading.
7. **Node target:** resolve stale Node 22 references; the confirmed contract target is Node 24/npm 11 unless deliberately revised everywhere.
8. **Long-running work:** whole-host restart must respect LMApi request draining and LMEval active-evaluation blocking.

---

## 2. Verified current baseline

Reference public revisions observed on 2026-08-15:

| Repository | Public branch/revision | Readiness summary |
|---|---|---|
| SourceManager | `master` / `20ac7743a518` | Existing Bun/Elysia v1 remains production baseline. `single-process` / `256da957e5db` contains partial Node/Express host work. |
| DevPlanner | `main` / `a383aee28066` | High migration effort; Bun/Elysia, Bun WebSockets/APIs/tests, import-time watchers/listen/signals, stale root npm lock. |
| LMApi | `main` / `90cdafeb4579` | Best first adapter; Node/Express 5 and standalone runtime work, but startup/Socket.IO/timers/path state are not import-safe. |
| MemoryApi | `main` / `4ec8daa9044c` | Existing routers help, but compiled npm start/ESM output is broken and import-time data/client initialization must be removed. |
| LMEval | `main` / `b029a88639cf` | Medium-high; Hono, Bun scripts, stale lock, incomplete backend type-check, and broken/accidental WebSocket dependency behavior. |

Verified SourceManager `single-process` reference checkout:

```text
npm ci       -> completed with engine warning on the reference Node 22/npm 10 host
npm test     -> 7 files passed; 16 tests passed; 8 skipped
npm run build -> typecheck, Vite build, server bundles, and manifest generation passed
```

Caveats:

- The branch declares Node 24/npm 11; rerun on that exact toolchain.
- Eight skipped tests mean sibling standalone parity is not proven.
- `npm audit` reported one high-severity issue in the reference install; triage without blindly applying breaking upgrades.

Verified sibling findings:

- DevPlanner root `npm ci` fails due stale `@elysiajs/openapi` lock data; its frontend build also has TypeScript failures.
- LMEval `npm ci` fails due stale/missing Playwright lock entries; 110 existing tests pass, but backend NodeNext type-checking fails.
- MemoryApi has 85 passing tests and can run source mode degraded, but `npm start` targets the wrong output and emitted ESM imports are not Node-runnable.
- LMApi has 220 passing tests; compiled standalone health and Socket.IO polling were verified.

---

## 3. Scope boundaries

### In scope

- npm/Node migration for every hosted web/API project;
- compiled, import-safe hosted adapters;
- standalone parity;
- one Express application and one `http.Server`;
- shared WebSocket/Socket.IO upgrade ownership;
- injected repository, asset, data, configuration, and logging paths;
- prefixed frontend routes/assets/APIs/realtime paths;
- module readiness/degradation/status and cleanup;
- project-level Git/install/build/verify/restart;
- one global Tailscale Service and one hosted URL tree;
- reversible v1-to-v2 rollout.

### Out of scope

- importing arbitrary discovered repositories without explicit configuration;
- moving all repositories into one monorepo or root npm workspace;
- general in-process hot module replacement for sibling adapters;
- placing Qdrant, Neo4j, Ollama, LM Studio, or OpenRouter inside the host process;
- converting stdio MCP into Express middleware merely to claim one process;
- deleting standalone project operation;
- removing v1 before the rollback window and acceptance matrix pass.

---

## 4. Required hosted contract

The existing `HostedApplication` contract remains the baseline. Each sibling adapter must provide the equivalent of:

```ts
interface HostedApplication {
  contractVersion: 1
  router?: Express.Router
  static?: { directory: string; spaFallback: boolean }
  initialize?(): Promise<void>
  attachRealtime?(server: http.Server): Promise<Disposer | void>
  status(): Promise<HostedModuleStatus>
  dispose?(): Promise<void>
}
```

Importing the adapter must not:

- listen on a port;
- open databases or external connections;
- create or modify files;
- start watchers, timers, queues, or background refreshes;
- install `SIGINT`/`SIGTERM` handlers;
- call `process.exit()`;
- mutate shared `process.env` or change the process working directory.

SourceManager must pass explicit options such as:

- `projectId`;
- `repoRoot`;
- `webBasePath`;
- `apiBasePath`;
- `realtimeBasePath`;
- `hostOrigin`;
- local project configuration;
- project-scoped logger;
- realtime registrar.

---

## 5. Continuation tasks

### Task 1: Reconcile the experimental branch and documentation

**Objective:** Make the `single-process` branch internally consistent before sibling implementation proceeds.

**Files:**

- Modify: `SourceManager/docs/features/unified-node-express-portal/architecture.md`
- Modify: `SourceManager/docs/features/unified-node-express-portal/decisions.md`
- Modify: `SourceManager/docs/features/unified-node-express-portal/tasks.md`
- Modify: `SourceManager/docs/features/unified-node-express-portal/lmapi-migration.md`
- Modify: `SourceManager/docs/features/unified-node-express-portal/lmeval-migration.md`
- Review: `SourceManager/docs/features/unified-node-express-portal/feature-removal.md`

**Steps:**

1. Create a fresh branch from the current `single-process` branch.
2. Rebase or merge current `master` only after inspecting conflicts and production behavior added since the branch diverged.
3. Standardize Node 24/npm 11 references across docs and manifests.
4. Refresh LMApi and LMEval current-state sections from current authoritative checkouts.
5. Change sibling migration order to DevPlanner → LMApi → MemoryApi → LMEval.
6. Mark v1 removal as gated, even where code has already been deleted on the experimental branch.
7. Record which management/Git/update functions are temporarily absent from v2.
8. Run SourceManager on the pinned toolchain:

```bash
node --version
npm --version
npm ci
npm test
npm run build
npm run verify:host
```

**Acceptance criteria:**

- Documentation, package engines, lockfile, and CI agree on one Node/npm target.
- No task is simultaneously marked complete and pending in a later deletion phase.
- Current public/target-machine revisions are clearly distinguished.
- v2 startup remains tolerant of missing sibling adapters.

---

### Task 2: Harden the host contract and integration harness

**Objective:** Prove that independently installed sibling adapters can be loaded safely before migrating a real application.

**Files:**

- Modify: `SourceManager/src/host/contract.ts`
- Modify: `SourceManager/src/host/loader.ts`
- Modify: `SourceManager/src/host/realtime.ts`
- Modify: `SourceManager/src/host/registry.ts`
- Test: `SourceManager/tests/vitest/host/*.test.ts`
- Create or update: fixture adapters under `SourceManager/fixtures/`

**Steps:**

1. Add a fixture that owns an Express router and static directory.
2. Add a fixture with a disposable timer and prove disposal.
3. Add `ws` and Socket.IO fixtures with distinct paths.
4. Import fixtures from sibling directories with independent dependencies.
5. Prove import causes no listener, file write, timer, or environment mutation before initialization.
6. Prove path traversal, symlink escape, duplicate mount, reserved prefix, wrong manifest, and wrong Node-major checks fail before listening.
7. Prove one broken fixture becomes unavailable without hiding healthy modules.

**Acceptance criteria:**

- Contract tests run with zero skipped core host cases.
- Realtime ownership is deterministic and detachable.
- Shutdown tests leave no open handles.
- Explicit configuration, not directory presence alone, controls code loading.

---

### Task 3: Migrate DevPlanner

**Objective:** Complete the highest-risk Bun/Elysia migration first and establish the adapter model with DevPlanner.

**Files:**

- Modify: `DevPlanner/package.json` and lockfiles
- Modify: `DevPlanner/src/server.ts`
- Port: `DevPlanner/src/routes/*.ts`
- Modify: Config, watcher, WebSocket, history, Git/worktree, dispatch, backup, vault, and adapter services
- Create: `DevPlanner/src/host.ts`
- Create: `DevPlanner/src/standalone.ts`
- Modify: `DevPlanner/frontend/vite.config.ts`
- Modify: React router/bootstrap, API, viewer/editor/download, and WebSocket clients
- Convert: Bun tests to Node-compatible Vitest
- Preserve: standalone MCP stdio npm command

**Steps:**

1. Reconcile root/frontend npm manifests and lockfiles until clean installs work.
2. Repair frontend TypeScript build failures and establish a scoped backend type-check.
3. Port Elysia route factories and validation/OpenAPI behavior to Express 5/Zod.
4. Replace Bun filesystem/process/test/WebSocket APIs with Node-compatible equivalents.
5. Convert global singleton services to factory-owned instances.
6. Move watcher/history/realtime/dispatch initialization into lifecycle hooks and add complete disposal.
7. Inject repository, DevPlanner content workspace, vault, backup, prompt, worktree, and MCP config paths.
8. Rebase Vite, BrowserRouter, APIs, WebSockets, viewer/editor routes, assets, downloads, and redirects.
9. Keep MCP stdio independently runnable; do not host `supergateway` as a hidden child process.
10. Produce compiled host/standalone outputs and pass parity tests.

**Acceptance criteria:**

- No required runtime/test/script Bun dependency remains.
- Clean npm install/build/test/start succeeds.
- Hosted web, direct SPA routes, APIs, file operations, downloads, OpenAPI/docs, watcher events, and WebSocket broadcasts pass.
- Standalone development retains backend watch, frontend HMR, and MCP stdio behavior.
- Shutdown leaves no watcher, timer, socket, lock, worktree command, or dispatch child process behind.

---

### Task 4: Migrate LMApi as the reference adapter

**Objective:** Prove the architecture with the lowest-risk, already-Express application after DevPlanner establishes the migration pattern.

**Files:**

- Modify: `LMApi/src/app.ts`
- Create: `LMApi/src/host/index.ts`
- Create: `LMApi/src/standalone.ts`
- Modify: LMApi configuration, DB, server-pool, request-registry, Socket.IO, and static-dashboard modules
- Modify: `LMApi/package.json`
- Modify: `LMApi/package-lock.json`
- Test: existing LMApi tests plus new host/standalone integration tests

**Steps:**

1. Ensure clean `npm ci`, tests, build, and standalone start pass before refactoring.
2. Extract router composition from server creation/listening.
3. Move DB/provider/server-pool/timer startup into `initialize()`.
4. Add an aggregate disposer for Socket.IO, SQLite, timers, queues, and server checks.
5. Attach Socket.IO to the supplied shared server at its configured path.
6. Inject repository, data, config, log, asset, API, web, and Socket.IO paths.
7. Move mutable server configuration out of `src/config/servers.json` into an injected writable path.
8. Rebase dashboard assets, links, fetches, and Socket.IO connection settings.
9. Produce compiled host and standalone outputs plus build manifest.
10. Verify standalone behavior and hosted behavior against the same route contracts.

**Acceptance criteria:**

- Existing 220-test baseline remains green or intentional changes are documented.
- Importing the host adapter has no startup side effects.
- Hosted health, REST/OpenAI routes, dashboard assets, Socket.IO polling, and WebSocket upgrade work.
- Standalone compiled startup remains functional.
- Graceful shutdown drains/stops active work according to the documented policy.

---

### Task 5: Migrate MemoryApi

**Objective:** Prove data-root injection, degraded readiness, and external-service independence after the DevPlanner and LMApi adapter patterns are established.

**Files:**

- Modify: `MemoryApi/package.json`
- Modify: `MemoryApi/package-lock.json`
- Modify: `MemoryApi/tsconfig.json` and/or add a bundler build configuration
- Modify: `MemoryApi/src/app/index.ts`
- Modify: `MemoryApi/src/app/memoryAPI.ts`
- Modify: `MemoryApi/src/app/reviewAPI.ts`
- Create: `MemoryApi/src/host/index.ts`
- Create: `MemoryApi/src/standalone.ts`
- Modify: path/config/SQLite/Qdrant/Neo4j/logger services
- Test: existing tests plus host/standalone/temp-data integration tests

**Steps:**

1. Fix compiled output and make `npm run build && npm start` work before host integration.
2. Upgrade/test Express 5.
3. Replace global singleton routers/services with a module factory and injected services.
4. Move database/client initialization into `initialize()`.
5. Inject explicit repository/data/prompt/tag/seed/review/log/report/public paths.
6. Load project configuration locally without mutating global environment state.
7. Return independent liveness and dependency-readiness/degradation status.
8. Add aggregate cleanup for SQLite, Neo4j, Qdrant clients, logger streams, and owned work.
9. Rebase the review UI/API calls under the hosted paths.
10. Keep MCP stdio as a separate npm executable; optionally extract shared tool registration without starting stdio on import.

**Acceptance criteria:**

- Existing 85-test baseline remains green or intentional changes are documented.
- Clean compiled standalone execution works.
- Hosted tests cannot write beneath SourceManager's data directory.
- Missing Qdrant/Neo4j/model providers degrade MemoryApi without crashing the host.
- MCP stdio continues passing an initialize/tools-list/tool-call smoke test independently.

---

### Task 6: Migrate LMEval

**Objective:** Prove Express migration, shared `ws`, project dependency routing, and active-work restart policy after the preceding adapters are established.

**Files:**

- Modify: `LMEval/package.json`
- Modify: `LMEval/package-lock.json`
- Modify: `LMEval/server/index.ts`
- Modify: `LMEval/server/ws.ts`
- Create: `LMEval/server/host.ts`
- Create: `LMEval/server/standalone.ts`
- Modify: backend path/config services
- Modify: `LMEval/vite.config.ts`
- Modify: React router/bootstrap and API/LMApi/WebSocket clients
- Test: existing tests plus backend type-check, host, standalone, WebSocket, and active-evaluation tests

**Steps:**

1. Reconcile package/lock files so `npm ci` succeeds.
2. Add direct `ws` dependency and remove CommonJS fallback behavior.
3. Add a real backend TypeScript build/type-check gate.
4. Port Hono routes/error handling to Express 5 routers, or document and test a deliberate adapter if route conversion is deferred.
5. Move seed/Git/data/report initialization into adapter lifecycle.
6. Inject repository/data/config/API/LMApi/realtime paths.
7. Attach and dispose WebSockets on the shared server.
8. Rebase Vite assets, React Router, API calls, LMApi calls, downloads, and WebSocket URLs.
9. Replace Bun and shell-background scripts with cross-platform npm scripts.
10. Report active evaluations and block automatic whole-host restart when required.

**Acceptance criteria:**

- `npm ci`, frontend build, backend type-check/build, tests, and compiled start all pass.
- Existing 110-test baseline remains green or intentional changes are documented.
- Hosted LMEval uses hosted LMApi through its HTTP contract, not imported internals.
- LMApi unavailability degrades LMEval rather than crashing SourceManager.
- Active-evaluation restart policy is exercised end-to-end.

---

### Task 7: Restore SourceManager's project-level update purpose

**Objective:** Make v2 a genuine SourceManager replacement rather than only a portal host.

**Files:**

- Create/modify: `SourceManager/src/routes/projects.ts`
- Create/modify: `SourceManager/src/routes/update.ts`
- Modify: `SourceManager/src/services/git.ts`
- Create: `SourceManager/src/services/npm.ts`
- Modify: project event/status persistence
- Modify: SourceManager frontend project cards/actions
- Test: Git/build/verify/restart/self-update and interrupted-state coverage

**Steps:**

1. Use `projectId` as update identity; remove service identity.
2. Preserve clean-tree, branch validation, fetch, checkout, and fast-forward-only pull safeguards.
3. Detect package metadata changes and apply an explicit npm install policy.
4. Build and verify the affected adapter before restart.
5. Keep the old host running when install/build/verification fails.
6. Persist update result before requesting restart.
7. Block restart when any module reports protected active work.
8. Gracefully shut down with a designated restart exit code.
9. Let the external Windows wrapper start exactly one new host.
10. Verify after boot that loaded commit equals checked-out commit.
11. Support SourceManager self-update through the same external boundary.

**Acceptance criteria:**

- Failed build does not replace the currently loaded application.
- Successful update performs one whole-host restart and reports the newly loaded commit.
- Active-work policies are honored.
- Self-update and crash-loop backoff are verified on the authoritative Windows host.

---

### Task 8: Integrated v2 rollout, Tailnet verification, and rollback

**Objective:** Prove the complete system before replacing v1 or deleting its rollback path.

**Files:**

- Modify: SourceManager v2 config examples and active target-machine v2 config only after preview/backup
- Modify: Windows production launcher/scheduled-task documentation
- Modify: Tailscale global service documentation/configuration
- Update: README, specification, OpenAPI, and migration status documents

**Steps:**

1. Build and verify all sibling adapters independently.
2. Run v2 on a non-production test port while v1 remains available.
3. Verify exactly one v2 Node listener and no hosted sibling HTTP child processes.
4. Execute the complete route matrix locally.
5. Verify from a second Tailnet device through `https://apps.<tailnet>.ts.net`.
6. Verify authentication, cookies/storage, streaming, downloads, WebSockets, Socket.IO polling/upgrades, and long-running requests.
7. Exercise each project's Git pull/build/restart workflow.
8. Exercise a failed build, broken adapter, unavailable dependency, and blocked restart.
9. Back up v1 configuration and production launcher state.
10. Switch the one Tailscale target and scheduled launcher to v2.
11. Observe a defined rollback window.
12. Remove v1 service/process/Tailscale code only after every deletion gate passes and rollback is no longer required.

**Acceptance criteria:**

- One SourceManager process owns the hosted listener.
- Every project is independently runnable and hosted-mode verified.
- One Tailscale Service exposes all configured paths.
- A broken/degraded project does not falsify other project status.
- Rollback restores the prior SourceManager release, config, launcher, and Tailnet target.

---

## 6. Cross-repository quality gates

Every repository must satisfy these commands from a clean checkout on the pinned toolchain:

```bash
npm ci
npm test
npm run build
npm start
npm run verify:host
```

Where a repository requires frontend/backend-specific commands, the root scripts must invoke them or document them explicitly.

Automated integration tests must also prove:

- importing the host export opens no TCP listener;
- importing performs no data/config writes;
- importing starts no watcher, timer, queue, database, external client, or signal handler;
- an unrelated launcher cwd does not change project path behavior;
- two adapters can coexist with separate data roots;
- route/static/SPA/API/realtime paths cannot collide;
- shared WebSocket upgrades are dispatched to one owner;
- all cleanup hooks release open handles;
- standalone paths and hosted paths both pass E2E checks;
- liveness and dependency readiness/degradation remain distinct;
- checked-out, built, and loaded commits are independently observable.

---

## 7. Recommended execution sequence

```text
1. Reconcile SourceManager branch/docs/toolchain
2. Harden hosted contract and fixtures
3. DevPlanner adapter
4. LMApi reference adapter
5. MemoryApi adapter
6. LMEval adapter
7. Restore project-level update/build/restart
8. Run local + Tailnet integration matrix
9. Switch production launcher/Tailscale target
10. Observe rollback window
11. Remove v1 only after deletion gates pass
```

Use one branch/PR per repository and one integration tracking card. Do not assume cross-repository changes can land atomically. SourceManager must remain tolerant of missing or incompatible adapters throughout migration.

---

## 8. Completion definition

The migration is complete only when:

- SourceManager runs under pinned Node/npm with no required Bun dependency;
- SourceManager owns one hosted HTTP listener;
- all four sibling projects load through verified compiled adapters;
- no hosted sibling starts an HTTP child process;
- each sibling still works independently through npm;
- Git pull/build/verify/restart workflows preserve SourceManager's original purpose;
- active LMApi/LMEval work is protected during restart;
- one Tailscale Service exposes the portal;
- current v1 configuration and launcher can be restored during the rollback window;
- documentation and tests describe the system that actually runs.

## 9. Existing detailed references

Use the repository documents for architectural and per-project detail:

```text
SourceManager/docs/features/unified-node-express-portal/README.md
SourceManager/docs/features/unified-node-express-portal/architecture.md
SourceManager/docs/features/unified-node-express-portal/decisions.md
SourceManager/docs/features/unified-node-express-portal/schema-and-routing.md
SourceManager/docs/features/unified-node-express-portal/host-adapter-guide.md
SourceManager/docs/features/unified-node-express-portal/sourcemanager-migration.md
SourceManager/docs/features/unified-node-express-portal/lmapi-migration.md
SourceManager/docs/features/unified-node-express-portal/memoryapi-migration.md
SourceManager/docs/features/unified-node-express-portal/lmeval-migration.md
SourceManager/docs/features/unified-node-express-portal/devplanner-migration.md
SourceManager/docs/features/unified-node-express-portal/feature-removal.md
SourceManager/docs/features/unified-node-express-portal/tasks.md
SourceManager/docs/features/unified-node-express-portal/windows-production.md
```

This artifact is the continuation map; those files remain the detailed design specification.
