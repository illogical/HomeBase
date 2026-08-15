# HomeBase

HomeBase is a planned central portal for Node applications. It will provide one
place to open current and future applications through a single Tailnet address,
with concise top-level routes such as `/devplanner`, `/lmapi`, `/memoryapi`, and
`/lmeval`.

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
The exact adapter interface has not been specified yet.

All hosted applications are trusted code. Although their repositories and npm
dependencies remain separate, hosted adapters share HomeBase's process, memory,
environment, permissions, and failure boundary.

## Routing and Tailnet access

HomeBase will own the only HTTP listener and Tailnet endpoint. Hosted applications
will be mounted at top-level slugs:

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

Applications will be registered explicitly rather than discovered by scanning
folders. The future configuration is expected to identify an application, its
repository and compiled adapter, its public route, whether it is enabled, and
the metadata needed by the dashboard. The schema and loading rules remain open
design work.

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

The precise layout is not final, but the project is expected to separate the
HomeBase server, dashboard, shared contracts, configuration, and documentation.
Participating applications will remain in their own repositories rather than
moving into this repository.

## Planning documents

- [Background and prior architecture review](docs/BACKGROUND.md)
- [HomeBase feature brainstorm](docs/BRAINSTORM.md)

After this initial direction is reviewed, `docs/SPECIFICATION.md` will define
the architecture and contracts. A later `docs/TASKS.md` will turn the approved
specification into a prioritized implementation sequence.

## Not decided yet

The configuration schema, exact hosted adapter API, authentication and
authorization policy, application loading mechanics, update and rollback policy,
and implementation order are intentionally deferred. They should not be treated
as established behavior until the specification is approved.
