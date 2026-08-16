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

HomeBase uses `server.port` from the selected JSON registry as its listener port;
the default local registry value is `17106`. When `HOMEBASE_PORT` is set, its
validated integer value takes precedence. An invalid override is a startup error
and must not silently fall back to the registry value. Docker must publish the
effective port on host loopback so the local endpoint is available at
`http://localhost:<port>` without exposing it directly on the LAN.

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

For local host development, npm scripts optionally load a root `.env`; values
already present in the process environment take precedence. The tracked
`.env.example` documents the supported variables, while `.env` and its local
variants remain ignored. A host path such as `/Users/matt/dev/projects` and a
future container path such as `/workspace` may identify the same mounted content
but are separate runtime values.

Repository source and build output are distinct from mutable runtime data. Each
hosted application receives an explicit application-scoped writable data path.
No application may infer writable storage from the process working directory or
write into another application's data directory.

`HOMEBASE_DATA_PATH` is required and must be an absolute path, as seen by the
Node process, identifying an existing directory: HomeBase's runtime-data root.
`ConfigService` validates it exactly like `HOMEBASE_WORKSPACE_PATH` (absolute,
resolved via `realpath`, must already exist as a directory). Beneath it:

- `<HOMEBASE_DATA_PATH>/homebase/log/homebase.ndjson` is HomeBase's own
  structured log (§7).
- `<HOMEBASE_DATA_PATH>/apps/<applicationId>/` is one writable directory per
  configured application, created by HomeBase with
  `mkdir(..., { recursive: true })` before that application's adapter is
  initialized — an adapter never infers or creates its own writable root.

The first container implementation plan will choose the final mount locations,
ownership, and read/write modes. It must preserve the workspace-relative path
contract defined here.

## 3. Configuration service and registry

### 3.1 Responsibilities

The configuration service is an in-process HomeBase server module. It:

- reads `config/homebase.json` by default or the file explicitly selected by
  `HOMEBASE_CONFIG_PATH`;
- validates the complete document before the HTTP listener starts;
- resolves repository and adapter paths beneath `HOMEBASE_WORKSPACE_PATH`;
- provides immutable normalized application records to the host and status API;
- reports actionable validation errors without silently dropping or changing
  entries; and
- never discovers or executes code merely because a folder or `package.json`
  exists.

The implemented `ConfigService` is constructed asynchronously once at the
composition root and supplied to dependants through constructor injection. No
other class reads the registry or environment directly. It publishes a deeply
immutable model containing effective server settings, resolved runtime paths,
compatibility versions, and normalized application records.

Configuration precedence is built-in defaults, the selected JSON registry, and
then environment overrides. Built-in defaults include port `17106`, the
project-root-relative `config/homebase.json`, schema and hosted-contract version
`1`, and Node major `24`. The registry remains required: defaults do not hide a
missing or invalid file. `HOMEBASE_WORKSPACE_PATH` has no default. Relative
`HOMEBASE_CONFIG_PATH` values resolve from the HomeBase project root rather than
the process working directory.

The tracked schema is [homebase.schema.json](../config/homebase.schema.json), and
the safe public template is
[homebase.example.json](../config/homebase.example.json). The operational
`config/homebase.json` file is local and ignored by Git. V1 has no browser or
HTTP configuration-write API.

### 3.2 Registry shape

The checked-in JSON Schema will use JSON Schema Draft 2020-12 and require this
top-level shape:

| Field | Type | Rules |
| --- | --- | --- |
| `schemaVersion` | integer | Required and exactly `1` for v1. |
| `server` | object | Required; contains the HomeBase listener configuration. |
| `server.port` | integer | Required; `1` through `65535`; overridden by a valid `HOMEBASE_PORT`. |
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
| `defaultBranch` | No | Informational non-empty default branch name. |
| `packageManager` | No | Informational non-empty package-manager name. |
| `devCommands` | No | Unique, non-empty standalone command strings; never executed by HomeBase configuration loading. |
| `tags` | No | Unique, non-empty presentation or capability labels. |
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

This compact example matches the tracked
[homebase.example.json](../config/homebase.example.json). It is a safe template,
not an operational registry. Copy it to the ignored `config/homebase.json` and
replace its values for a real workspace before enabling an application.

```json
{
  "schemaVersion": 1,
  "server": {
    "port": 17106
  },
  "applications": [
    {
      "id": "example-app",
      "displayName": "Example App",
      "description": "Replace this entry with an application in your workspace.",
      "slug": "example-app",
      "enabled": false,
      "repoPath": "ExampleApp",
      "adapterPath": "dist/host/index.js",
      "contractVersion": 1,
      "defaultBranch": "main",
      "packageManager": "npm",
      "devCommands": [
        "npm run dev"
      ],
      "tags": [
        "example"
      ],
      "category": "Examples",
      "sortOrder": 10
    }
  ]
}
```

Standalone application ports, health paths, IP allowlists, Tailnet exposure, and
process-management settings remain owned by each sibling repository. They are
not HomeBase registry fields because hosted applications share HomeBase's one
listener and lifecycle.

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
consume HomeBase or another application's routes. For example, LMApi's own
API surface is reachable at paths such as `/lmapi/...`; HomeBase's `/api`
prefix is reserved exclusively for HomeBase's own read-only API
(`/api/applications`) and is never a per-app namespace.

Disabled applications are not imported or mounted. Their cards remain visible
as disabled. Enabled applications that fail to load remain visible as
unavailable, and requests beneath their slug receive an application-scoped
unavailable response rather than another application's SPA.

### 4.2 Read-only APIs

V1 reserves these HomeBase-owned API capabilities:

- `GET /api/applications` — a public, read-only application listing containing
  presentation metadata, public base path, and sanitized availability (`id`,
  `displayName`, `description`, `basePath`, `state`, `statusSummary`); and
- `GET /health` and `GET /ready` — health and readiness endpoints for
  container and Tailnet verification.

Public responses must not expose repository paths, adapter paths, writable data
paths, environment variables, stack traces, dependency credentials, or raw
configuration. V1 provides no create, update, delete, reload, Git, build, or
restart endpoint.

`GET /api/applications` reports the full seven-state lifecycle from §6, sourced
live from `ApplicationHost.statusFor(id)` for every configured application (no
caching, no polling). `disabled` and `unavailable` derive directly from
configuration and load outcome; `ready`/`degraded` are read live from each
loaded adapter's `getStatus()`, bounded to 2000 ms per call so the endpoint
stays bounded even with several applications.

### 4.3 Shared browser origin

All hosted applications share one browser origin. Each application must namespace
cookie names, browser-storage keys, service workers, realtime endpoints, and
other origin-wide state. Applications may not register a service worker whose
scope can intercept HomeBase or sibling routes. Security-header and identity
propagation contracts require a later aligned plan before hosted applications
depend on them.

## 5. Hosted application contract

The shared TypeScript contract is versioned independently of any one
application and implemented at `src/contracts/hostedApplication.ts`
(`HOSTED_CONTRACT_VERSION = 1`):

```ts
export type ApplicationLifecycleState =
  | "disabled" | "loading" | "initializing"
  | "ready" | "degraded" | "unavailable" | "stopping";

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
  readonly contractVersion: 1;
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

A compiled adapter's ES module default export must be a
`CreateHostedApplication` factory function, not a pre-built object: evaluating
the module performs only module-level declarations, the factory call
constructs the object from injected options and must still perform no I/O, and
all real resource acquisition happens inside `initialize()`. `basePath` is
always the reserved `/${slug}/` form computed by `ConfigService`; adapters must
not hardcode their own slug. `hostOrigin` (sourced from the optional
`HOMEBASE_PUBLIC_ORIGIN` environment variable) is informational only — v1 does
not require adapters to depend on an absolute origin. `config` is the
application's optional, opaque `adapterConfig` registry field, passed through
uninterpreted.

`ApplicationHost` (`src/services/ApplicationHost.ts`) enforces these exact
lifecycle timeouts: dynamic import plus the factory call, combined, 5000 ms;
`initialize()`, 10000 ms; `attachRealtime()`, 5000 ms (a failure here does not
flip the application back to `unavailable` — realtime is a supplementary
capability); live `getStatus()` reads from the applications API, 2000 ms each;
`getActiveWork()` during shutdown, 2000 ms each application plus one shared
5000 ms grace window if any report active work; combined realtime-disposer-and-
`dispose()` budget per application during shutdown, 5000 ms, applied in reverse
registry order so one hung or failing adapter cannot block or fail its
siblings' disposal; and an overall 20000 ms shutdown watchdog that force-exits
the process if disposal has not completed by then.

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

All seven states are reachable: `ApplicationHost` loads enabled applications in
stable registry order, one at a time, transitioning each through
`loading` → `initializing` → (loaded, reporting live `ready`/`degraded` from
`getStatus()`) or `unavailable` on any failure. After shutdown begins, every
loaded application reports `stopping` regardless of what `getStatus()` would
say.

HomeBase health means the process and HTTP event loop can respond. Readiness
means the registry is valid, HomeBase routes are mounted, and startup
reconciliation has completed. Readiness does not require every enabled
application to be ready; per-application states carry that information.

HomeBase initializes enabled applications in stable registry order. Shutdown
stops accepting new traffic, marks applications as stopping, checks reported
active work, disposes initialized adapters in reverse order, closes the shared
server, and exits within the documented bound in §5. v1 does not implement
unbounded draining: a shared 5000 ms grace window is honored once, then
shutdown proceeds regardless.

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

HomeBase owns one append-only NDJSON sink
(`<HOMEBASE_DATA_PATH>/homebase/log/homebase.ndjson`, §2.3), written through
one `RootLogger` constructed once in `startServer.ts` before any application
loads and bound to `serviceName: "homebase"` plus a random
`serviceInstanceId`. `RootLogger.child({ applicationId })` returns a bound
child logger passed into each adapter's `HostedApplicationOptions.logger`; a
child cannot rebind `applicationId` or `serviceName`. Records carry
`timestamp`, `severityText`, `body`, `eventName`, `serviceName`,
`serviceInstanceId`, `applicationId`, `component`, `requestId`, `attributes`,
and `error`; `traceId`/`spanId` stay absent until a later OpenTelemetry-export
phase. The default minimum level is `info`; `HOMEBASE_LOG_LEVEL` overrides it.
Outside `NODE_ENV=production`, `info` and above are also mirrored to the
console.

The sink is bounded: 50 MiB active-file rotation, UTC-midnight time-based
rotation, the 7 most recent rotated files retained, and the oldest rotated
file deleted first if total log disk usage would exceed a 500 MiB soft budget.
A write failure (disk full, permission error, rotation failure) never throws
into caller code: the sink falls back to one structured `stderr` line per
dropped record and marks an internal, non-public `loggingDegraded` flag that
never changes `GET /health` or `GET /ready`. A bounded `flush(2000)` runs once
during shutdown, after all adapters have been disposed, so their final
lifecycle records are not lost.

`attributes` and `error` are redacted before serialization: `authorization`,
`cookie`, and `set-cookie` headers and any key containing `token`, `secret`,
`password`, or `apikey` (case-insensitive) are redacted; string values over
2 KiB are truncated; arrays and objects are capped at 50 entries. An
`AsyncLocalStorage`-backed request context, populated by request-ID middleware
mounted first in `src/app.ts`, lets `RootLogger` attach `requestId`
automatically.

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
