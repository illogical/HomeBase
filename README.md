# HomeBase

HomeBase is a planned central portal for Node applications. It will provide one
place to open current and future applications through localhost or a single
Tailnet address, with concise top-level routes such as `/devplanner`, `/lmapi`,
`/memoryapi`, and `/lmeval`.

> [!IMPORTANT]
> HomeBase is in the planning stage. This README describes the intended
> direction, not an implemented or verified system.

## Project goals

- Run one Node process with one Express application and one shared HTTP server.
- Present a fast, simple dashboard for navigating hosted applications.
- Use a restrained dark visual design with neutral, warm, and natural accents.
- Expose HomeBase through `home.<tailnet>.ts.net` without separately exposing
  each hosted application.
- Keep application repositories independently buildable, testable, and runnable.
- Allow HomeBase to remain available in a degraded state when one application
  cannot load.

## Application model

Each participating repository will remain an independent npm project with its
own `package.json`, lockfile, dependencies, tests, and build output. It will
support two entry points:

1. A standalone entry point for developing and running the application on its
   own.
2. An import-safe hosted adapter that HomeBase can load into its process without
   opening another listener.

HomeBase will load compiled JavaScript adapters rather than importing sibling
TypeScript source trees. A hosted adapter is expected to provide the capabilities
needed to initialize the application, mount its routes and static assets, attach
realtime behavior to the shared server, report status, and release its resources.
The v1 adapter capabilities and lifecycle guarantees are defined in the
[specification](docs/SPECIFICATION.md); exact TypeScript types will be fixed in
the hosted-architecture implementation plan.

All hosted applications are trusted code. Although their repositories and npm
dependencies remain separate, hosted adapters share HomeBase's process, memory,
environment, permissions, and failure boundary.

## Routing and Tailnet access

HomeBase will own the only HTTP listener. Docker will publish its
environment-configured port on host loopback, and host-managed Tailscale Serve
will proxy the Tailnet endpoint to that same listener. Hosted applications will
be mounted at top-level slugs:

```text
https://home.<tailnet>.ts.net/
https://home.<tailnet>.ts.net/devplanner
https://home.<tailnet>.ts.net/lmapi
https://home.<tailnet>.ts.net/memoryapi
https://home.<tailnet>.ts.net/lmeval
```

HomeBase-owned paths such as `/api`, `/assets`, and internal health endpoints
will be reserved. Hosted frontends and realtime clients will need to work from
their configured base paths. Route validation and the complete reserved-path
policy will be defined in the specification.

## Configuration direction

Applications will be registered explicitly in validated JSON rather than
discovered by scanning folders. `HOMEBASE_WORKSPACE_PATH` identifies the absolute
mounted workspace root, and each application uses traversal-safe repository and
adapter paths relative to that root. The in-process configuration service and
registry contract are defined in the [specification](docs/SPECIFICATION.md).

## Initial technology baseline

- Node.js 24
- npm
- TypeScript
- Express 5
- React
- Vite

Exact package versions, supporting libraries, and compatibility rules will be
selected during specification and implementation planning.

## Expected repository shape

The precise implementation layout will be selected in feature plans, but the
project will separate the HomeBase server, dashboard, shared contracts,
configuration, writable runtime data, and documentation. Participating
applications remain in their own repositories beneath a mounted workspace root
rather than moving into this repository.

## Planning documents

- [Background and prior architecture review](docs/BACKGROUND.md)
- [HomeBase feature brainstorm](docs/BRAINSTORM.md)
- [Approved v1 specification](docs/SPECIFICATION.md)
- [Development priorities and progress](docs/TASKS.md)
- `docs/plans/` for decision-complete implementation plans created after feature
  alignment

The brainstorm collects possibilities. The specification defines approved v1
behavior, and the task index identifies current progress and the next development
priority. Each separate project update receives an aligned implementation plan
under `docs/plans/` and is implemented only when requested in a fresh session.

## Deferred beyond v1

Per-user authentication and authorization, browser-based configuration editing,
coordinated cross-repository hot reload, Git inspection and mutation, dependency
installation, update and rollback automation, audit controls, and advanced portal
features require separate expectation alignment and implementation plans. They
must not be treated as implemented or approved v1 behavior.
