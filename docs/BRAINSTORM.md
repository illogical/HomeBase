# HomeBase Feature Brainstorm

> [!NOTE]
> This document collects possibilities and design concerns. It is not an
> implementation commitment. Decisions will move into `SPECIFICATION.md` after
> review and then into a prioritized `TASKS.md`.

## Product vision

HomeBase should be the single entry point for current and future Node
applications. One memorable Tailnet address, `home.<tailnet>.ts.net`, should open
a focused portal that makes every available application easy to find and launch.

The experience should feel calm and practical:

- dark mode as the primary presentation;
- neutral, warm, or natural accent colors rather than sci-fi purple and blue;
- clear typography and generous spacing;
- responsive navigation for desktop, tablet, and mobile;
- application cards with a name, short description, status, and direct link;
- quick access to top-level routes such as `/devplanner` and `/lmapi`;
- useful empty, loading, degraded, and unavailable states;
- keyboard-accessible navigation and visible focus states.

Possible later dashboard enhancements include categories, search, favorites,
recently used applications, version information, and concise operational notices.
These should only be added when they improve navigation rather than turning the
portal into a complex administration console.

## Runtime architecture

The intended architecture is one npm-launched Node process, one Express
application, and one shared `http.Server`. HomeBase is the composition root and
owns:

- the HTTP listener and graceful shutdown sequence;
- application registration and route mounting;
- shared WebSocket and Socket.IO upgrade dispatch;
- dashboard and internal API routes;
- initialization order, status collection, and disposal;
- process-level error handling and logging.

There will not be a separate npm process or reverse proxy for each hosted
application. Each participating project instead supplies compiled code that can
be loaded into the HomeBase process.

This architecture reduces listener and routing overhead, but it does not provide
process isolation. A memory leak, uncaught error, CPU-heavy operation, unsafe
global mutation, or compromised hosted module can affect the entire portal.
Those risks need explicit contracts, tests, and operational safeguards.

## Standalone and hosted applications

Participating projects should support both modes without maintaining two separate
implementations:

### Standalone mode

- The project can be installed, built, tested, and run from its own repository.
- Its standalone entry point creates and owns its HTTP server.
- Local development can retain project-appropriate watch and hot-reload tools.

### Hosted mode

- HomeBase imports a compiled JavaScript adapter rather than project source.
- Importing the adapter does not listen on a port or start background work.
- HomeBase supplies paths, route bases, configuration, logging, and shared-server
  access through explicit options.
- The adapter initializes only when HomeBase asks it to.
- The adapter releases timers, watchers, sockets, database handles, queues, and
  other owned resources when disposed.

The future hosted contract should be capable of describing:

- initialization;
- an Express router or equivalent route registration;
- a static asset directory and optional SPA fallback;
- realtime attachment to the shared HTTP server;
- liveness, readiness, degradation, and human-readable status;
- active work that may prevent a safe restart;
- orderly disposal.

The precise TypeScript interface and lifecycle ordering belong in the
specification.

## Application registry

HomeBase should use explicit validated configuration. Scanning arbitrary folders
may eventually help suggest applications, but the presence of a `package.json`
must never be enough to execute code.

Registry fields to evaluate include:

- stable application ID;
- display name, description, icon, category, and sort order;
- repository path;
- compiled hosted-adapter entry point;
- top-level public slug;
- enabled state;
- expected contract and Node versions;
- optional health, readiness, and active-work behavior;
- application-specific configuration and writable data paths.

Configuration validation should occur before the listener starts. Invalid or
duplicate applications should produce actionable errors without silently
mounting an unexpected module.

## Routing

Hosted applications should use concise top-level routes such as `/devplanner`,
`/lmapi`, `/memoryapi`, and `/lmeval`. HomeBase should reserve its own paths,
including at least `/api`, `/assets`, and internal health endpoints.

Route rules to define include:

- valid slug syntax and normalization;
- duplicate, nested, and reserved-route detection;
- whether slugs are case-sensitive;
- redirects between `/app` and `/app/`;
- API and static asset namespacing beneath an application's base path;
- safe SPA fallbacks that cannot consume another application's routes;
- behavior when a configured application is disabled or unavailable.

Every hosted project must be base-path aware. This includes:

- generated asset URLs and Vite base configuration;
- client-side router basenames and deep links;
- API calls, downloads, redirects, forms, and cookies;
- WebSocket and Socket.IO paths;
- OpenAPI documents and other generated links.

Hard-coded root paths are likely to work in standalone mode and fail when hosted,
so route parity needs automated coverage in both modes.

## Degraded operation and status

One application failing to load or initialize should not prevent HomeBase and
healthy applications from starting. The failed application should remain visible
as unavailable with a useful reason, without exposing secrets or stack traces to
ordinary dashboard users.

Status should distinguish at least:

- disabled or not configured;
- adapter missing or incompatible;
- loading or initializing;
- ready;
- degraded because a dependency is unavailable;
- failed;
- stopping.

Startup isolation cannot protect against every runtime failure in a shared
process. The specification should define process-level handling for uncaught
errors, rejected promises, fatal adapter faults, and shutdown timeouts.

## Separate npm packages: benefits and concerns

Keeping each application as its own npm project is compatible with HomeBase's
single-process goal. Each repository can retain its own `package.json`, lockfile,
`node_modules`, release cadence, tests, and standalone commands. HomeBase can
load the repository's compiled hosted entry point without absorbing its source
tree or dependencies into a monorepo.

Important constraints remain:

- HomeBase and every adapter must support a compatible Node version and module
  format.
- Framework and shared-contract compatibility must be validated even when npm
  resolves separate dependency copies.
- Native addons must support the host platform and Node ABI.
- Hosted modules must not take ownership of global signal handlers, call
  `process.exit()`, change the working directory, or mutate shared environment
  state.
- Importing a module must not create files, connect to dependencies, start
  timers, open sockets, or register watchers.
- Initialization failures should be contained and all partially acquired
  resources cleaned up.
- Application-specific configuration, writable data, logs, and caches need
  unambiguous paths to avoid cross-project collisions.
- Dependency installation and builds still happen per repository, so deployment
  must verify every configured adapter before switching versions.
- Replacing loaded code safely will normally require rebuilding the application
  and gracefully restarting the whole HomeBase process.

All hosted adapters are trusted code with the same operating-system permissions
as HomeBase. Separate package boundaries improve ownership and reproducibility;
they are not security or runtime isolation boundaries.

## Tailnet access and security

Only HomeBase should need Tailnet service configuration. Its listener will expose
the dashboard and all mounted routes through `home.<tailnet>.ts.net`.

Questions for the specification include:

- whether Tailnet identity alone is sufficient for access;
- whether HomeBase or individual applications enforce additional authorization;
- how identity reaches hosted adapters;
- how cookies, sessions, CSRF protection, and security headers behave across
  application paths on one origin;
- which internal status and administration routes ordinary users can see;
- whether any loopback or LAN access is permitted;
- how security-relevant actions are audited.

The shared origin makes navigation convenient but also means applications share
a browser security boundary. Cookie names, storage keys, service workers, CSP,
and route ownership need coordination.

## Operations and observability

Potential operational capabilities include:

- HomeBase and per-application liveness and readiness;
- structured, application-scoped logs;
- startup progress and initialization timing;
- checked-out, built, and loaded Git revisions;
- dependency and adapter compatibility diagnostics;
- Git pull, npm install, build, and verification workflows;
- update staging that leaves the currently loaded version intact on failure;
- graceful whole-host restart after a verified update;
- active-work protection before restart;
- bounded shutdown with complete adapter disposal;
- external launcher restart and crash-loop protection;
- configuration backup and rollback.

The initial dashboard may expose only navigation and basic availability. More
powerful controls should arrive after their failure modes and permissions are
specified.

## Candidate applications

The first applications expected to explore the hosted model are:

- DevPlanner;
- LMApi;
- MemoryApi;
- LMEval.

HomeBase should not require every candidate to be installed or healthy. The
migration order should be chosen later from dependency relationships, adapter
complexity, and the value of proving the hardest architectural risks early.

## Open specification questions

The following decisions are deliberately deferred to `SPECIFICATION.md`:

- the exact registry schema, file locations, validation, and local overrides;
- the hosted adapter TypeScript API and version-negotiation policy;
- module loading, dependency resolution, and build-manifest validation;
- initialization order and whether application dependencies form a graph;
- exact route, static-file, SPA fallback, and realtime ownership rules;
- authentication, authorization, browser security, and Tailnet trust boundaries;
- health, readiness, degradation, retry, and fatal-error behavior;
- logging, status persistence, metrics, and audit events;
- update, restart, active-work, rollback, and external launcher behavior;
- cross-platform support and production host assumptions;
- minimum standalone and hosted test contracts.

After those decisions are approved, `TASKS.md` should prioritize foundational
contracts and integration fixtures before individual application migrations,
then finish with operations, Tailnet verification, rollout, and rollback work.
