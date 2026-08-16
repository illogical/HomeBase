# HomeBase

HomeBase is a central portal for Node applications. It will provide one
place to open current and future applications through localhost or a single
Tailnet address, with concise top-level routes such as `/devplanner`, `/lmapi`,
`/memoryapi`, and `/lmeval`.

> [!IMPORTANT]
> The Phase 1 configuration runtime is complete. The Phase 2 static dashboard
> prototype is implemented with automated and live HTTP checks, while its manual
> browser acceptance matrix remains pending. Live dashboard data, hosted
> adapters, public APIs, Docker packaging, and Tailnet rollout remain planned
> work unless stated otherwise.

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

`ConfigService` is the server's single source of effective configuration. It
validates the entire registry before the listener starts and exposes one
immutable object model to dependent classes through constructor injection.
Precedence is built-in defaults, `homebase.json`, then environment variables.

## Local setup

HomeBase requires Node.js 24 and npm. From a clean clone:

```sh
npm ci
cp .env.example .env
cp config/homebase.example.json config/homebase.json
```

Edit `.env` so `HOMEBASE_WORKSPACE_PATH` is the absolute directory containing
the registered application repositories. On this development machine, for
example:

```dotenv
HOMEBASE_WORKSPACE_PATH=/Users/matt/dev/projects
```

Then edit the ignored `config/homebase.json` and run:

```sh
npm run typecheck
npm test
npm run dev
```

The development command serves the React dashboard and Vite HMR through the
same Express listener. Open `http://localhost:<effective-port>/`, where the
effective port is `HOMEBASE_PORT` when set, otherwise `server.port` from the
selected registry (the example registry uses `17106`). Vite does not open a
second user-facing port.

Phase 2 uses static sample data only. These URLs preview its three fixture
scenarios:

```text
http://localhost:<effective-port>/?fixture=mixed
http://localhost:<effective-port>/?fixture=loading
http://localhost:<effective-port>/?fixture=empty
```

Unknown `fixture` values use `mixed`. Application routes are shown for context
but are deliberately not clickable, and the displayed statuses do not describe
real processes.

To view the production build on the same configured listener:

```sh
npm run build
npm start
```

Phase 2 does not include Docker packaging. On Windows, install Node.js 24, use
the same local configuration files, and run `npm ci`, `npm run typecheck`,
`npm test`, `npm run build`, and `npm start` before reviewing the fixture URLs
in a browser. Docker and Tailnet verification are deferred to Phase 6.

The root `.env` and operational registry are intentionally ignored. The tracked
`.env.example` and `config/homebase.example.json` are safe starting points.
`HOMEBASE_PORT` optionally overrides `server.port`, while
`HOMEBASE_CONFIG_PATH` selects another registry using either an absolute path or
a path relative to the HomeBase repository root. Invalid overrides prevent
startup rather than silently falling back.

The workspace path is interpreted by the running Node process. A future Docker
deployment might mount the host projects directory at `/workspace` and set
`HOMEBASE_WORKSPACE_PATH=/workspace`; it should not reuse a host-only absolute
path inside the container.

## Initial technology baseline

- Node.js 24
- npm
- TypeScript
- Express 5
- React
- Vite

The Phase 1 server uses strict TypeScript, Express 5, Ajv Draft 2020-12
validation, and Vitest. The Phase 2 dashboard uses React and Vite with a
separate browser TypeScript configuration and production output beneath
`dist/dashboard`.

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
