# HomeBase v1 Specification

> [!IMPORTANT]
> This document defines the approved architecture and contracts for HomeBase v1.
> It describes intended behavior, not an implemented or runtime-verified system.
> New ideas in [BRAINSTORM.md](BRAINSTORM.md) do not change this specification
> until they are aligned, planned, and incorporated here.

## 1. Product boundary

HomeBase is a central portal for trusted Node applications. It provides one
dashboard and one HTTP origin from which users can open independently maintained
applications at concise top-level routes such as `/devplanner` and `/lmapi`.

V1 proves four things:

1. HomeBase can load an explicit, validated application registry.
2. The portal can present configured applications and honest availability states.
3. Independent applications can remain standalone while exposing import-safe,
   compiled hosted adapters.
4. One Dockerized Node process, Express application, and shared HTTP server can
   serve HomeBase and all enabled hosted applications without route or realtime
   collisions.

V1 does not include browser-based configuration editing, per-user authorization,
Git mutation, dependency installation, automated application updates, rollback
automation, or a general administration console.

## 2. Runtime and deployment

### 2.1 Process model

- The runtime baseline is Node.js 24, npm, TypeScript, Express 5, React, and Vite.
- HomeBase is launched as one Docker container containing one Node process, one
  Express application, and one shared `http.Server`.
- HomeBase owns the only listener, process signal handling, application lifecycle,
  realtime upgrade dispatch, and graceful shutdown sequence.
- Hosted applications are trusted code loaded into the HomeBase process. Separate
  repositories and package installations are ownership and reproducibility
  boundaries, not security or failure-isolation boundaries.
- A hosted application must also remain independently installable, buildable,
  testable, and runnable from its own repository.

### 2.2 Local and Tailnet access

HomeBase listens on a port supplied through `HOMEBASE_PORT`. The first
implementation plan will select the sample default and final container port
mapping. Docker must publish the port on host loopback so the local endpoint is
available at `http://localhost:<port>` without exposing it directly on the LAN.

Tailscale runs on the host, not in the HomeBase container or a sidecar. A
host-managed Tailscale Serve configuration proxies
`https://home.<tailnet>.ts.net` to the loopback endpoint. Docker and Tailscale
configuration must be documented and verified independently; starting HomeBase
must not mutate host Tailscale configuration.

### 2.3 Workspace and writable data

`HOMEBASE_WORKSPACE_PATH` is required and must be an absolute path as seen by the
Node process. In Docker it identifies the mounted root whose immediate or nested
children contain the participating Git repositories. Registry `repoPath` values
are always relative to this root.

Repository source and build output are distinct from mutable runtime data. Each
hosted application receives an explicit application-scoped writable data path.
No application may infer writable storage from the process working directory or
write into another application's data directory.

The first container implementation plan will choose the final mount locations,
ownership, and read/write modes. It must preserve the workspace-relative path
contract defined here.

## 3. Configuration service and registry

### 3.1 Responsibilities

The configuration service is an in-process HomeBase server module. It:

- reads an explicitly selected JSON registry file;
- validates the complete document before the HTTP listener starts;
- resolves repository and adapter paths beneath `HOMEBASE_WORKSPACE_PATH`;
- provides immutable normalized application records to the host and status API;
- reports actionable validation errors without silently dropping or changing
  entries; and
- never discovers or executes code merely because a folder or `package.json`
  exists.

The first implementation plan will select the final registry and schema file
locations and any environment variable used to select a registry. V1 has no
browser or HTTP configuration-write API.

### 3.2 Registry shape

The checked-in JSON Schema will use JSON Schema Draft 2020-12 and require this
top-level shape:

| Field | Type | Rules |
| --- | --- | --- |
| `schemaVersion` | integer | Required and exactly `1` for v1. |
| `applications` | array | Required; application IDs and slugs must be unique. |

Each application object has these fields:

| Field | Required | Rules |
| --- | --- | --- |
| `id` | Yes | Stable lowercase identifier matching `^[a-z][a-z0-9-]*$`. |
| `displayName` | Yes | Non-empty dashboard label. |
| `description` | Yes | Concise, non-empty dashboard description. |
| `slug` | Yes | Lowercase top-level route segment matching the ID syntax; stored without `/`. |
| `enabled` | Yes | Boolean controlling whether HomeBase attempts to load the adapter. |
| `repoPath` | Yes | Relative path from the workspace root to the repository. |
| `adapterPath` | Yes | Relative path from the repository root to compiled JavaScript. |
| `contractVersion` | Yes | Integer; exactly `1` for the v1 hosted contract. |
| `icon` | No | Non-empty icon identifier or application-relative asset reference. |
| `category` | No | Non-empty presentation label. |
| `sortOrder` | No | Integer used before display-name ordering. |

Unknown fields are rejected. The schema validates document shape, while the
configuration service performs cross-entry and filesystem-aware validation.

### 3.3 Path and route validation

Before listening, configuration validation rejects:

- duplicate application IDs or slugs;
- empty, absolute, dot-only, or parent-traversing `repoPath` and `adapterPath`
  values;
- paths which resolve outside the workspace or repository, including through a
  symbolic link;
- missing repository directories or missing adapter output for an enabled
  application when loading is attempted;
- unsupported schema, hosted-contract, or Node major versions;
- nested slugs, case variants, percent-encoded separators, query fragments, or
  slugs that normalize to a different value; and
- HomeBase-reserved route names.

Document and safety errors invalidate the registry and prevent the listener from
starting. A valid registry may reference an enabled adapter that later fails to
import or initialize; that is an application availability failure and does not
prevent degraded startup.

### 3.4 Illustrative registry

This example describes the intended model. It is not the checked-in schema or
runtime configuration; Phase 1 in [TASKS.md](TASKS.md) will create and test those
artifacts.

```json
{
  "schemaVersion": 1,
  "applications": [
    {
      "id": "devplanner",
      "displayName": "DevPlanner",
      "description": "Plan and coordinate development work.",
      "slug": "devplanner",
      "enabled": true,
      "repoPath": "DevPlanner",
      "adapterPath": "dist/host/index.js",
      "contractVersion": 1,
      "category": "Development",
      "sortOrder": 10
    },
    {
      "id": "lmapi",
      "displayName": "LMApi",
      "description": "Use local language-model APIs and tools.",
      "slug": "lmapi",
      "enabled": true,
      "repoPath": "LMApi",
      "adapterPath": "dist/host/index.js",
      "contractVersion": 1,
      "category": "AI",
      "sortOrder": 20
    },
    {
      "id": "memoryapi",
      "displayName": "MemoryApi",
      "description": "Explore and manage memory services.",
      "slug": "memoryapi",
      "enabled": true,
      "repoPath": "MemoryApi",
      "adapterPath": "dist/host/index.js",
      "contractVersion": 1,
      "category": "AI",
      "sortOrder": 30
    },
    {
      "id": "lmeval",
      "displayName": "LMEval",
      "description": "Run and review language-model evaluations.",
      "slug": "lmeval",
      "enabled": false,
      "repoPath": "LMEval",
      "adapterPath": "dist/host/index.js",
      "contractVersion": 1,
      "category": "AI",
      "sortOrder": 40
    }
  ]
}
```

## 4. HTTP and browser contracts

### 4.1 Route ownership

HomeBase owns `/`, `/api`, `/assets`, `/health`, `/ready`, and any path nested
beneath them. These first segments are reserved and cannot be application slugs.
Additional reserved slugs must be added to the schema validation and documented
before use.

An application with slug `example` owns `/example` and `/example/*`. HomeBase
normalizes `/example` to `/example/` with a redirect so relative browser URLs
have one base. An application's API, assets, SPA fallback, redirects, forms,
downloads, generated links, client-side routes, cookies, WebSockets, and
Socket.IO paths must remain beneath that base path. Its SPA fallback must never
consume HomeBase or another application's routes.

Disabled applications are not imported or mounted. Their cards remain visible
as disabled. Enabled applications that fail to load remain visible as
unavailable, and requests beneath their slug receive an application-scoped
unavailable response rather than another application's SPA.

### 4.2 Read-only APIs

V1 reserves these HomeBase-owned API capabilities:

- a public, read-only application listing containing presentation metadata,
  public base path, and sanitized availability;
- a public, read-only application status lookup containing state, summary, and
  last transition time; and
- health and readiness endpoints for container and Tailnet verification.

The exact URLs and JSON wire shapes will be fixed by the configuration-integration
implementation plan. Public responses must not expose repository paths, adapter
paths, environment variables, stack traces, dependency credentials, or raw
configuration. V1 provides no create, update, delete, reload, Git, build, or
restart endpoint.

### 4.3 Shared browser origin

All hosted applications share one browser origin. Each application must namespace
cookie names, browser-storage keys, service workers, realtime endpoints, and
other origin-wide state. Applications may not register a service worker whose
scope can intercept HomeBase or sibling routes. Security-header and identity
propagation contracts require a later aligned plan before hosted applications
depend on them.

## 5. Hosted application contract

The shared TypeScript contract will be versioned independently of any one
application. Its v1 behavior is equivalent to:

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

The eventual interface will also define explicit creation options containing the
application ID, repository root, web/API/realtime base paths, host origin,
application-scoped writable data path, application-specific configuration, and
scoped logger. Concrete TypeScript types and lifecycle timeouts will be fixed in
the hosted-architecture implementation plan without weakening these guarantees.

Importing an adapter must not:

- listen on a port or attach realtime handlers;
- open databases or external connections;
- create or modify files;
- start timers, watchers, queues, or background work;
- install signal or process-level error handlers;
- call `process.exit()`, change the working directory, or mutate shared
  environment state.

Initialization happens only when HomeBase requests it. On partial initialization
failure, the adapter must release resources it already acquired. Disposal must
be idempotent and release timers, watchers, sockets, database handles, queues,
and other application-owned resources.

## 6. Lifecycle, status, and failures

Application status uses these states:

| State | Meaning |
| --- | --- |
| `disabled` | Configuration exists but HomeBase did not import the adapter. |
| `loading` | Import or compatibility validation is in progress. |
| `initializing` | The adapter is acquiring its runtime resources. |
| `ready` | The application can serve its intended v1 capabilities. |
| `degraded` | It can serve requests but one or more dependencies or capabilities are impaired. |
| `unavailable` | The adapter is missing, incompatible, or failed to import or initialize. |
| `stopping` | HomeBase has begun disposal and no new work should be accepted. |

Statuses include a concise human-readable summary and transition timestamp.
Public summaries are sanitized; full diagnostic errors go only to structured
logs. A missing, incompatible, or failed optional adapter does not falsify the
status of healthy applications and does not prevent the HomeBase dashboard from
starting.

HomeBase health means the process and HTTP event loop can respond. Readiness
means the registry is valid, HomeBase routes are mounted, and startup
reconciliation has completed. Readiness does not require every enabled
application to be ready; per-application states carry that information.

HomeBase initializes enabled applications in stable registry order. Shutdown
stops accepting new traffic, marks applications as stopping, checks reported
active work, disposes initialized adapters in reverse order, closes the shared
server, and exits within a documented bound. Exact drain policy and timeouts must
be selected in the hosted-lifecycle plan before production rollout.

Unexpected process-level errors are logged with application context where it can
be determined. Startup isolation cannot make arbitrary trusted code safe after a
fatal process error, so the external container runtime remains responsible for
process restart and crash-loop controls.

## 7. Logging and operational visibility

HomeBase and adapters emit structured logs with timestamp, level, component,
application ID when applicable, event name, and sanitized context. Secrets and
raw environment values must not be logged. Startup, status transitions,
initialization failures, realtime attachment, disposal, health, and shutdown
timing must be observable.

V1 status is runtime truth, not a claim about Git checkout, build, or loaded
revision. Checked-out, built, and loaded revision tracking belongs to a later
Git-aware plan.

## 8. Frontend experience

The first frontend milestone is a static visual prototype. It uses fixture data
to establish the responsive dashboard, restrained dark palette, warm or natural
accents, typography, spacing, application cards, keyboard navigation, visible
focus, and loading, empty, disabled, degraded, and unavailable states. It does
not imply that configuration loading or runtime status is connected.

A separate integration phase replaces fixture data with the read-only
configuration/status API. Application cards show display name, description,
status, and direct route. Disabled and unavailable cards remain discoverable but
must not present a working launch action.

Search, favorites, recent applications, categories as navigation, version
details, update controls, and administrative editing are deferred unless a later
approved plan adds them.

## 9. Delivery and change control

Implementation follows the priorities and status in [TASKS.md](TASKS.md). Each
separate project update, including every sibling adapter migration, requires an
aligned, decision-complete plan under `docs/plans/` before implementation.

Plans may refine undecided implementation details identified in this document.
They may not silently contradict an established v1 contract. A change to this
specification must be part of the aligned planning work and be reflected in the
task index.

