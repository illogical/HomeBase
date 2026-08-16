# Logging and OpenTelemetry Evolution Intentions

**Status:** Draft  
**Planning scope:** HomeBase logging foundation, participating-application logging contract, and longer-term centralized observability  
**Implementation status:** Not started  
**Related phases:** Phase 4 hosted architecture, Phase 5 application integrations, Phase 6 container rollout, and a later Phase 7 observability capability

## Purpose

Establish one logging direction that works when an application runs independently
and when its hosted adapter runs inside HomeBase. Begin with a bounded local
structured log file, without committing HomeBase to becoming a log-storage
engine, and preserve a direct evolution path toward OpenTelemetry collection,
correlation, metrics, traces, and centralized visibility from the HomeBase UI.

This document captures aligned intentions and the decisions that subsequent
implementation plans must preserve. It is not implementation authorization. It
remains `Draft` because final local retention limits, the HomeBase runtime-data
location, the first central backend, and observability access controls have not
yet been selected.

## User-visible outcomes

### Initial local logging outcome

- A user can inspect one structured local HomeBase log containing HomeBase and
  all in-process hosted-application events.
- The same application emits the same event names and fields when it runs
  independently, but writes through a standalone-owned logger to that
  application's own local log file.
- Every hosted record can be filtered by application, component, severity,
  event, runtime instance, request, and operation or trace context when present.
- Application initialization, degradation, request failures, realtime
  attachment, disposal, and shutdown are observable without exposing secrets or
  raw user content.
- Logging resources are created only during explicit runtime initialization and
  are flushed and released during bounded disposal.

### Longer-term centralized outcome

- A collector can ingest the structured records without rewriting every
  application logger.
- Logs, metrics, and traces use OpenTelemetry-compatible identity and
  correlation fields.
- After Git integration, observability can distinguish checked-out, built, and
  loaded revisions.
- HomeBase can offer read-only search, filtering, live-tail, status correlation,
  and links between logs and traces while a dedicated backend owns ingestion,
  retention, indexing, and querying.

## Scope

### In scope

- a small logger contract supplied through hosted-adapter creation options;
- root logger and child/scoped logger ownership in hosted and standalone modes;
- newline-delimited structured JSON as the first durable local format;
- explicit absolute log destinations rather than `process.cwd()` assumptions;
- application, component, event, request, runtime-instance, and future trace
  correlation;
- sanitization, redaction, bounded buffering, rotation, retention, flushing,
  disposal, and degraded behavior;
- a field model that maps intentionally to OpenTelemetry concepts;
- future collector, centralized backend, Git-revision enrichment, metrics,
  traces, alerting, and HomeBase observability views; and
- automated and manual verification required in HomeBase and each participating
  repository.

### Out of scope for the initial local-file implementation

- selecting or deploying Loki, Grafana, an OpenTelemetry Collector, or a hosted
  observability vendor;
- browser-to-server log forwarding;
- treating ordinary diagnostic logs as a security audit trail;
- exposing raw logs through a public v1 API;
- per-user authorization, alert delivery, or incident-management integration;
- full distributed tracing or application metrics; and
- using log messages as the source of truth for application health or lifecycle
  state.

## Confirmed current-state facts

- HomeBase currently writes only unstructured startup and startup-failure
  messages to the console. It does not yet load hosted adapters.
- The approved HomeBase specification already requires a scoped logger in
  hosted-adapter creation options and structured records containing timestamp,
  level, component, application ID, event name, and sanitized context.
- Phase 4 already requires structured application-scoped logging and bounded
  shutdown. The concrete contract and implementation plan do not yet exist.
- DevPlanner and LMEval primarily use direct `console.*` calls.
- LMApi uses Pino with pretty console output and a daily rolling file rooted at
  `process.cwd()`.
- MemoryApi creates custom file streams rooted at `process.cwd()` and may create
  more than one logger instance. Some current MemoryApi and LMApi events include
  raw request or memory content that must not be carried into the shared policy.
- Relative file destinations, import-time transports, process-owned signal
  handlers, and application-owned sinks are incompatible with the planned
  shared-process adapter lifecycle.

These sibling-repository observations are planning leads. Each Phase 5 plan must
revalidate its repository's current implementation before prescribing changes.

## Architecture decisions to preserve

### 1. Applications depend on a logging contract, not a sink

The hosted contract will expose a deliberately small structured logger API. The
exact TypeScript types belong in the Phase 4 hosted-architecture plan, but the
behavior should be equivalent to:

```ts
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

interface ApplicationLogger {
  child(bindings: Readonly<Record<string, unknown>>): ApplicationLogger;
  log(
    level: LogLevel,
    event: string,
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ): void;
  flush?(): Promise<void>;
}
```

Convenience methods may be included. Event names and structured context remain
separate from the human-readable message. Adapter and application code must not
import HomeBase's concrete logger, transport, or file writer.

### 2. Sink ownership differs by mode, while event semantics remain the same

**Hosted mode:** HomeBase creates and owns one root logging pipeline. It passes a
child logger bound to the application ID into each adapter. Hosted adapters do
not create a file, transport, worker, or OpenTelemetry provider and do not close
the HomeBase root logger. All hosted records initially enter one HomeBase-owned
newline-delimited JSON file.

**Standalone mode:** The application's standalone composition root creates a
root logger using the same contract and field conventions, binds its application
ID, supplies it to the same factories used by the hosted adapter, and owns its
flush and shutdown. Its log destination belongs to its own explicit writable
runtime-data location.

**Concurrent standalone and hosted runs:** They must use different files and
different runtime-instance IDs. Two processes must never append through
independent writers to the same active file. This prevents rotation races,
interleaved partial records, and one process renaming a file still owned by the
other.

Pretty console output may mirror the structured stream during interactive
development. The structured local file is the canonical initial diagnostic
record. Container collection may later make structured stdout the canonical
production transport, but that choice belongs in the Phase 6 plan.

### 3. Paths are explicit and lifecycle-safe

- No logger may derive a write destination from `process.cwd()`.
- HomeBase's composition root receives or resolves an absolute HomeBase log
  destination beneath a HomeBase-owned writable runtime-data root.
- A standalone composition root receives or resolves an absolute
  application-owned log destination.
- A hosted adapter receives only its scoped logger, not authority to choose a
  destination.
- Importing an adapter must not create directories, open files, start transport
  workers, or register process handlers.
- Root logger creation occurs during explicit host or standalone startup.
- Shutdown performs a bounded flush after adapter disposal has emitted its final
  lifecycle events. The external runtime remains responsible for retaining
  output after a fatal process failure.

The final HomeBase runtime-data environment or configuration field and its
container mount must be selected in the applicable implementation plan and, if
it changes an established contract, added to the specification in the same
update.

### 4. The initial file format is OpenTelemetry-oriented NDJSON

Each physical line is one complete JSON object. Multiline messages and stack
traces are JSON string values rather than physical multiline records. The
minimum logical fields are:

| Field | Purpose and OpenTelemetry direction |
| --- | --- |
| `timestamp` | UTC event time; maps to an OpenTelemetry event timestamp. |
| `observedTimestamp` | Optional ingest/write time when materially different. |
| `severityText` | Stable textual severity. |
| `severityNumber` | Optional OpenTelemetry severity number added by the logging implementation or collector. |
| `body` | Concise human-readable message. |
| `eventName` | Stable machine-filterable event name. |
| `serviceName` | Process owner: `homebase` when hosted, or the standalone application ID. |
| `serviceInstanceId` | Unique runtime/process instance identifier. |
| `applicationId` | Logical HomeBase application/module ID in both modes. |
| `component` | Bounded subsystem name, suitable for mapping to `code.namespace`. |
| `requestId` | HomeBase or standalone ingress correlation identifier, when applicable. |
| `traceId` / `spanId` | Reserved for valid OpenTelemetry trace context when available. |
| `attributes` | Sanitized structured context with bounded keys and values. |
| `error` | Sanitized error type, message, code, and optional internal stack. |

The implementation may serialize these as flat or nested JSON, but it must
publish and test one stable mapping. Custom names should map predictably to
OpenTelemetry resource or log attributes later. `applicationId` remains present
even when `serviceName` changes between hosted and standalone execution.

### 5. Correlation begins before full tracing

- HomeBase and standalone HTTP entry points generate or validate a request ID.
- Request context is propagated through asynchronous work using a runtime-safe
  mechanism such as `AsyncLocalStorage`.
- Background operations receive an explicit operation or job ID when there is no
  originating request.
- Realtime connections and messages receive bounded connection/message
  correlation where useful.
- Trace and span fields remain absent rather than populated with invented IDs
  until real trace context exists.
- Future W3C Trace Context propagation and OpenTelemetry spans must reuse these
  boundaries rather than introduce a parallel correlation model.

### 6. Data minimization and redaction are mandatory

The default policy must exclude:

- authorization and cookie headers, credentials, tokens, API keys, and raw
  environment values;
- complete prompts, model responses, memories, files, request bodies, uploaded
  content, embeddings, and database records;
- filesystem paths in public responses and unnecessary absolute paths in logs;
- unbounded arrays, objects, stack traces, and third-party response bodies; and
- secrets embedded in URLs or error objects.

Prefer identifiers, counts, byte sizes, model/provider names, durations,
outcomes, sanitized error codes, and truncated safe summaries. Redaction happens
before the record reaches any sink. Tests must use canary secrets and sensitive
payloads to prove that neither the local file nor mirrored console contains
them.

### 7. Local persistence is bounded and failure-aware

The first implementation must select and document:

- maximum active-file size and/or time-based rotation;
- maximum retained files, age, and total disk budget;
- file permissions and ownership;
- bounded in-memory buffering and backpressure behavior;
- how lower-severity events are sampled or dropped under pressure;
- a bounded flush deadline; and
- recovery after disk-full, permission, rotation, or write failures.

Intent: an unavailable file sink does not by itself crash HomeBase or a healthy
application. The pipeline falls back to a minimal structured stderr record,
marks internal logging as degraded, and avoids an unbounded retry loop. The
hosted-architecture and container plans must decide whether this affects
readiness or only an internal operational status.

Exact byte, age, count, retry, and flush limits remain open and are why this
intentions document is `Draft` rather than an approved implementation plan.

### 8. Status and logs have different responsibilities

Application status remains the current sanitized runtime truth. Logs explain
transitions and failures but are not replayed to reconstruct authoritative
status. Public status responses never expose raw diagnostic records or stacks.
Every lifecycle transition emits an event with previous state, next state,
reason code, duration where applicable, and application attribution.

## DevPlanner-specific planning requirements

The DevPlanner npm and Express migration plan must account for both execution
modes:

- replace direct server-side `console.*` dependencies with an injected
  `ApplicationLogger` or a DevPlanner-local facade implementing the same
  semantics;
- keep browser console behavior separate from server observability during the
  initial migration;
- have the standalone entry point create and own the DevPlanner local file
  logger, listener, signal handlers, and final flush;
- have the hosted adapter accept HomeBase's scoped logger and create no sink or
  process-level logging resource;
- inject the logger into watchers, WebSocket handling, history, Git/worktree,
  dispatch, backup, vault, route, and lifecycle components instead of relying on
  global console calls;
- propagate request and operation IDs into watcher-triggered work, dispatch
  child-process reporting, WebSocket events, and Git/worktree operations where
  causality exists;
- sanitize child-process commands and output, repository paths, card content,
  prompts, and environment-derived values;
- prove that standalone DevPlanner and hosted DevPlanner can run concurrently
  without sharing an active log file; and
- preserve independently runnable MCP stdio logging without sending diagnostic
  logs to its protocol stdout. MCP diagnostics must use stderr or an explicitly
  configured file sink.

## Phased implementation path

### Phase A: HomeBase hosted logging contract

1. Align the remaining limits and path/configuration decisions.
2. Write and approve the Phase 4 hosted-architecture implementation plan.
3. Define the logger contract, normalized record model, event naming rules,
   redaction policy, and explicit root-logger lifecycle.
4. Implement a HomeBase-owned NDJSON file sink and scoped child loggers.
5. Add request/operation context and lifecycle instrumentation.
6. Verify fixture adapters cannot create or close the root sink.

### Phase B: Participating application migrations

For each Phase 5 repository, revalidate current logging, create a separate
approved plan, preserve its standalone workflow, replace global or
application-owned hosted sinks, and run the shared logging acceptance matrix.
Existing application log dashboards or log-file readers must either consume the
new contract through a supported boundary or be explicitly migrated/deferred;
they must not inspect another process's active file directly.

### Phase C: Container collection and persistence

The Phase 6 plan selects writable mounts, permissions, rotation responsibility,
container stdout behavior, log-driver configuration, disk limits, restart
semantics, and rollback. It must prevent duplicate unbounded persistence between
the application file and the container runtime.

### Phase D: Git-aware enrichment

After Git visibility exists, add distinct checked-out, built, and loaded revision
attributes. Never infer one from another. Deployment/update operation IDs link
Git workflows, build verification, host restart, and subsequent lifecycle logs.

### Phase E: OpenTelemetry collection and central backend

1. Select an OpenTelemetry Collector deployment model and a log backend through
   a separate aligned plan.
2. Tail or receive the structured records, transform the published field mapping
   into OpenTelemetry log records, batch them, and export them without blocking
   application requests.
3. Add real trace context and spans for HomeBase ingress, hosted routing,
   realtime operations, inter-application HTTP calls, databases, and external
   model providers.
4. Add bounded-cardinality metrics for request rate, error rate, duration,
   initialization, active work, queues, dependency status, dropped log records,
   and shutdown.
5. Define retention, backup expectations, collector outage behavior, alerting,
   resource budgets, and rollback.

Direct application use of an OpenTelemetry Logs SDK is not required for the
first local-file milestone. The logger contract and file mapping are the
compatibility boundary so the collector or a future bridge can evolve without
forcing application-wide rewrites.

### Phase F: HomeBase observability experience

Create a separate plan for authenticated or appropriately Tailnet-restricted,
read-only observability APIs and UI. The HomeBase server queries the backend with
server-side credentials. The browser receives sanitized records and supports
application, severity, event, time, request, trace, runtime instance, and Git
revision filters. Central storage, query execution, and retention remain outside
the HomeBase process.

## Automated verification

### Shared contract and HomeBase fixtures

- valid records serialize as one JSON object per physical line;
- required fields and event names are present and stable;
- application child loggers cannot override bound identity fields;
- request and operation context survives representative asynchronous work;
- canary secrets and raw sensitive payloads are absent from file and console;
- multiline errors remain single physical records;
- adapter import creates no log directory, file, worker, or open handle;
- initialization and disposal events are attributed correctly;
- repeated disposal is safe and root flush happens once within its bound;
- simulated permission, disk, rotation, and slow-sink failures follow the
  documented degraded behavior without unbounded memory growth; and
- one failed adapter does not falsify healthy-application status or attribution.

### Per-application verification

- standalone and hosted modes emit the same representative event schema;
- standalone startup owns its file and final flush;
- hosted startup uses only the injected HomeBase child logger;
- concurrent standalone and hosted runs use separate files and instance IDs;
- direct server-side console calls are eliminated or explicitly justified at
  process-boundary bootstrap/fatal-fallback locations;
- no application creates a hosted logger during import;
- disposal leaves no logger stream, timer, worker, or other open handle; and
- MCP stdio protocol output is not corrupted by diagnostic logging.

### Future OpenTelemetry verification

- collector mapping preserves timestamps, severity, service/application
  identity, event names, trace context, and sanitized attributes;
- collector or backend outage does not block or crash HomeBase;
- retry queues and local buffers remain bounded;
- metrics have bounded label cardinality;
- a request can be followed from HomeBase ingress through an application and an
  external dependency using request or trace correlation; and
- checked-out, built, and loaded revision filters report distinct verified
  values.

## Manual acceptance checks

1. Start an application independently and confirm its local NDJSON file is
   readable, bounded, attributed, and free of known secrets.
2. Start HomeBase with multiple fixture or real adapters and confirm one
   HomeBase-owned file can be filtered cleanly by application and component.
3. Run standalone DevPlanner concurrently with hosted DevPlanner and confirm
   separate active files and runtime-instance IDs.
4. Trigger initialization degradation, a request error, realtime connect and
   disconnect, active work, and shutdown; correlate the resulting records with
   sanitized status transitions.
5. Interrupt or deny the file sink and confirm bounded fallback behavior and an
   honest internal degraded indication.
6. When central collection is later implemented, stop the collector, restore it,
   and confirm bounded recovery without affecting application availability.

## Deployment, monitoring, and rollback

- The initial logger must be additive to runtime behavior and must not make
  adapter availability depend on an external service.
- Rollback restores the previous logger wiring and removes only new
  process-owned logging resources; it must not delete historical log files.
- Container deployment must document writable mounts, file ownership, disk
  limits, retention, and whether stdout duplicates the local file.
- Operational monitoring must include sink health, write failures, dropped
  records, buffer utilization, collector/export failures, and disk pressure.
- Central-backend credentials must never be sent to hosted applications or the
  browser.
- Historical local files are diagnostic artifacts, not application data or a
  durable audit ledger, and may be removed according to the aligned retention
  policy.

## Documentation changes required during implementation

- Update `docs/SPECIFICATION.md` if the concrete logger interface, runtime-data
  path, configuration, readiness behavior, or public APIs establish or change a
  v1 contract.
- Link each approved implementation plan from `docs/TASKS.md` and record verified
  status accurately.
- Document local log location, format, rotation, retention, permissions,
  redaction, development console behavior, container behavior, and troubleshooting
  in the HomeBase README or an operations guide.
- Update every participating repository's README, environment example, and
  operations documentation for standalone logging and hosted logger injection.

## Assumptions and deliberately deferred decisions

### Assumptions

- HomeBase remains the only process owner in hosted mode.
- Participating web applications continue to support standalone operation.
- HomeBase and adapters are trusted code but log data is still treated as
  sensitive.
- The initial local file is primarily for local diagnostics and a later
  collector input, not an API contract for arbitrary readers.
- A concrete logger such as Pino may implement the contract, but application
  code depends only on the project-owned interface and record conventions.

### Decisions required before approval

- the HomeBase runtime-data root and configuration/environment contract;
- initial file size, time, retained-count, retained-age, and total-disk limits;
- file permissions and whether local development mirrors every level to a pretty
  console;
- whether local file-sink failure changes HomeBase readiness or only internal
  operational status;
- the maximum flush deadline and pressure/drop policy;
- whether the Phase 6 production source is the local file, structured stdout, or
  one canonical sink with the other disabled; and
- later central backend, collector placement, access control, retention, and
  alert destinations.

## Initial-plan acceptance gate

This intentions plan may become `Approved` only after the decisions above are
closed and any affected specification contract is updated. Initial local logging
is complete only when HomeBase fixtures and at least one participating
application prove standalone and hosted parity, import safety, separate
concurrent writers, redaction, bounded persistence, failure fallback, and clean
disposal. Centralized observability remains a separate later acceptance gate and
must not be claimed from local-file logging alone.
