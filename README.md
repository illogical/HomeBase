# HomeBase

HomeBase is a central portal for Node applications. It will provide one
place to open current and future applications through localhost or a single
Tailnet address, with concise top-level routes such as `/devplanner`, `/lmapi`,
`/memoryapi`, and `/lmeval`.

> [!IMPORTANT]
> Phases 1 through 4 are complete: the configuration runtime, the static
> dashboard prototype, live `GET /api/applications` data backed by
> `ConfigService`, and the hosted-application architecture proof (import-safe
> adapter loading, mounting, realtime attachment, structured logging, and
> bounded shutdown) are all implemented and verified with automated checks.
> Docker packaging and Tailnet rollout (Phase 6) are implemented and verified
> for build, local/loopback run, health, graceful stop, rollback, and
> Tailscale Serve mechanics; reachability from a second physical Tailnet
> device is pending tailnet-admin approval of the named service (see
> `docs/features/2026-08-16-container-and-tailnet-deployment.md`). Real
> sibling-repository migration (Phase 5) remains planned work unless stated
> otherwise.

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
[specification](docs/SPECIFICATION.md) and implemented as the versioned
`HostedApplication`/`CreateHostedApplication` contract in
`src/contracts/hostedApplication.ts`.

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
the registered application repositories, and `HOMEBASE_DATA_PATH` is an
absolute, existing, writable directory HomeBase uses for its own log file and
one writable subdirectory per configured application. On this development
machine, for example:

```dotenv
HOMEBASE_WORKSPACE_PATH=/Users/matt/dev/projects
HOMEBASE_DATA_PATH=/Users/matt/dev/homebase-data
```

HomeBase writes its own structured NDJSON log to
`<HOMEBASE_DATA_PATH>/homebase/log/homebase.ndjson` (rotated at UTC midnight
or at 50 MiB, whichever comes first, retaining the 7 most recent rotated
files under a 500 MiB total budget) and creates
`<HOMEBASE_DATA_PATH>/apps/<applicationId>/` for every configured application
before its adapter is initialized. `HOMEBASE_LOG_LEVEL` (default `info`) and
the optional, informational `HOMEBASE_PUBLIC_ORIGIN` are documented in
`.env.example`.

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

The dashboard loads its application list from a small read-only HTTP API,
backed by the same validated registry `ConfigService` loads at startup:

- `GET /api/applications` — sanitized, presentation-only listing of every
  configured application (no filesystem or adapter path is ever included).
- `GET /health` — `200` once the process is accepting requests.
- `GET /ready` — `200` once configuration has loaded successfully.

Application status reflects the real hosted-application lifecycle state
machine (`disabled`, `loading`, `initializing`, `ready`, `degraded`,
`unavailable`, `stopping`) reported live by `ApplicationHost`, per
`docs/SPECIFICATION.md` §6. The dashboard performs a one-shot load on first
render; a failed load shows a "Retry loading applications" button rather than
polling automatically.

### Exercising hosted adapters locally

`test/fixtures/adapters/` contains nine self-contained fixture adapters
(`routes`, `static-assets`, `spa-fallback`, `websocket`, `socket-io`,
`degraded`, `failing`, `active-work`, `cleanup`) that satisfy the
`CreateHostedApplication` contract in `src/contracts/hostedApplication.ts`
without touching a real sibling repository. To try one against a real running
HomeBase process, point a scratch registry entry's `repoPath` at
`test/fixtures/adapters/<name>` (relative to `HOMEBASE_WORKSPACE_PATH`) and
`adapterPath` at `index.ts`, set `enabled: true`, then run `npm run build`
(or `npm run dev`) and `npm start`. `GET /api/applications` reports the
adapter's real state, its `basePath` serves its mounted routes/static
assets/SPA fallback, and `Ctrl+C` exercises the bounded, reverse-order
shutdown sequence described in the
[Phase 4 hosted architecture proof](docs/plans/2026-08-15-phase-4-hosted-architecture-proof.md).

To view the production build on the same configured listener:

```sh
npm run build
npm start
```

On Windows, install Node.js 24, use the same local configuration files, and
run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and
`npm start` before reviewing the dashboard and `/api/applications`, `/health`,
and `/ready` in a browser.

## Docker and Tailnet deployment

HomeBase also runs as one Docker container with one Node process and one
shared HTTP server, per `docs/SPECIFICATION.md` §2. From a clean clone:

```sh
docker build -t homebase:latest .
cp .env.docker.example .env.docker   # fill in real absolute host paths
docker compose --env-file .env.docker -f docker-compose.yml up -d
```

`.env.docker` (git-ignored) supplies `HOMEBASE_HOST_WORKSPACE_PATH` (mounted
read-only at `/workspace`), `HOMEBASE_HOST_DATA_PATH` (mounted read-write at
`/data`; must already exist and be writable by UID 1000 before the first
run), and `HOMEBASE_HOST_CONFIG_PATH` (the operational, git-ignored registry,
mounted read-only). The `--env-file` flag is required in addition to the
`env_file:` entry already in `docker-compose.yml` — see
`.env.docker.example` for why. The container publishes its port on host
loopback only (`127.0.0.1:<port>:<port>`); never omit that host qualifier.

After changing `src/**`, `dashboard/src/**`, or any other file baked into the
image, rebuild it and recreate the running container to pick up the change —
the production container serves a static bundle compiled at build time, so
edits on the host have no effect until it is rebuilt:

```sh
docker compose --env-file .env.docker -f docker-compose.yml build
docker compose --env-file .env.docker -f docker-compose.yml up -d
```

or, equivalently, in one step:

```sh
docker compose --env-file .env.docker -f docker-compose.yml up -d --build
```

Host-managed Tailscale Serve then proxies `https://home.<tailnet>.ts.net` to
that loopback port; Tailscale itself always runs on the host, never inside
the container. Full commands, verified output, a rollback procedure, and an
honest account of what has and has not been end-to-end verified from a
second Tailnet device are in
[the container and Tailnet deployment doc](docs/features/2026-08-16-container-and-tailnet-deployment.md).

The root `.env` and operational registry are intentionally ignored. The tracked
`.env.example` and `config/homebase.example.json` are safe starting points.
`HOMEBASE_PORT` optionally overrides `server.port`, while
`HOMEBASE_CONFIG_PATH` selects another registry using either an absolute path or
a path relative to the HomeBase repository root. Invalid overrides prevent
startup rather than silently falling back.

The workspace path is interpreted by the running Node process. The Docker
deployment mounts the host projects directory at `/workspace` and sets
`HOMEBASE_WORKSPACE_PATH=/workspace` inside `docker-compose.yml`; it does not
reuse a host-only absolute path inside the container.

### Git status and credentials for private repositories

Both `git config --system safe.directory` entries (for `/workspace`,
`/mnt/devplanner-vault`, and `/mnt/devplanner-workspace`) and a `credential.helper`
pointing at a mounted file are baked into the image via the `Dockerfile`, so bind
mounts are trusted regardless of the host UID that owns them, and git looks for
credentials at a fixed path with no secret baked into the image itself. Actually
supplying a credential is only needed if one of those mounted directories is a
private git repository (for example, DevPlanner's AgentVault vault, mounted at
`/mnt/devplanner-vault`); public repositories need nothing further.

To wire up credentials for a private repository:

1. **Create a GitHub fine-grained personal access token** at
   [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens),
   scoped to only the specific repositories that need to be read (for example, just
   `illogical/AgentVault`), with repository permission **Contents: Read-only** and
   nothing else (`Metadata: Read-only` is auto-required by GitHub and harmless). Do
   not use a classic token or grant broader scope than that — neither DevPlanner's
   vault git integration (`status`/`diff`/stage/local `commit`/`show`, never a
   network operation) nor SourceManager's update flow (`fetch`/`checkout`/`pull`,
   never `push`) writes to any remote repository today. If push support is ever
   added to one of those apps, regenerate the token with `Read and write` at that
   point — not before.
2. **Copy `git-credentials.docker.example` to `git-credentials.docker`** (git-ignored,
   same pattern as `.env.docker`) and replace the placeholder with the token in
   `https://x-access-token:<token>@github.com` format.
3. **Set `HOMEBASE_HOST_GIT_CREDENTIALS_PATH`** in `.env.docker` to the absolute host
   path of that file. If no private repositories are configured, point it at any
   existing empty file instead — the compose files require the variable to be set
   either way.
4. Rebuild/recreate the container as usual; the file is bind-mounted read-only at
   `/run/secrets/git-credentials`, never passed as an environment variable, so it
   never appears in `docker inspect` output or process environment dumps.

To rotate or revoke the token, replace the token in `git-credentials.docker` and
restart the container (or revoke it directly from GitHub's fine-grained PAT
settings) — no image rebuild is needed, since the file is read fresh by git's
credential-store helper on each git invocation rather than cached.

### Docker development mode

A second, dev-only image and Compose file give the same edit-and-see-it-update
loop as `npm run dev`, but running inside a container, using the same
`.env.docker` as production:

> [!NOTE]
> Hot-reload only works while the **dev** container is the one running.
> `docker ps` will show it as `homebase-homebase-dev-1`, image `homebase:dev`
> — if instead `homebase:latest` is running, that's the production container
> serving a static bundle baked in at build time, and edits will silently do
> nothing until you switch containers (see below).

```sh
docker compose --env-file .env.docker -f docker-compose.dev.yml up -d --build
```

This builds the `dev` target (full `npm ci`, no build step, no baked source)
and bind-mounts the whole repository into the container, so edits to
`dashboard/src/**` update the browser via Vite HMR/Fast Refresh with no
manual reload, and edits to `src/**` trigger an automatic backend restart —
both without rebuilding the image. A named volume
(`homebase-dev-node-modules`) keeps the container's own Linux-built
`node_modules` in place underneath the bind mount; reset it with
`docker compose -f docker-compose.dev.yml down -v` after a dependency change.

`docker-compose.dev.yml` and `docker-compose.yml` publish the same host port
by default, so only one can run at a time unless you override
`HOMEBASE_PORT` for one of them — stop the other first:

```sh
# switching from prod to dev
docker compose --env-file .env.docker -f docker-compose.yml down
docker compose --env-file .env.docker -f docker-compose.dev.yml up -d --build

# switching from dev to prod
docker compose --env-file .env.docker -f docker-compose.dev.yml down
docker compose --env-file .env.docker -f docker-compose.yml up -d --build
```

Both watchers run in polling mode (`CHOKIDAR_USEPOLLING=true` for Vite;
`nodemon --legacy-watch` for the backend, in place of the local `npm run
dev` script's `node --watch`) because native `fs.watch`/inotify events from
a Windows-host bind mount are not forwarded reliably through Docker Desktop.
This is scoped to the Docker dev container only; local, non-Docker `npm run
dev` is unaffected and keeps using native file-watch events.

### Hot reload for hosted sibling applications

Hosted applications (DevPlanner, LMApi, MemoryApi, LMEval) are loaded as
**compiled** adapters (`dist/host/index.js`, per `adapterPath` in
`config/homebase.json`), so an edit to a sibling's source is only visible once
that sibling is rebuilt and its adapter is re-imported. In **development mode
only** (`npm run dev`, or the `homebase-dev` container), HomeBase now does both
for you:

1. It watches each enabled sibling's source tree and, when a change settles,
   runs that sibling's own build scripts — the same `build:hosted`/`build` plus
   `build:host` pair described below.
2. It watches each sibling's compiled adapter file and, when it changes, hot
   reloads that one application in place: the old instance is disposed, the new
   adapter is re-imported, and the live instance is swapped. HomeBase does not
   restart, and no other application is touched.

So editing a sibling's backend source ends with its API serving the new code,
and editing its frontend source ends with the rebuilt bundle served on the next
browser refresh (static assets are read from disk per request, so they need no
reload). Watch progress and build failures in HomeBase's log —
`docker compose --env-file .env.docker -f docker-compose.dev.yml logs -f
homebase-dev` — under the `dev-reload` component: `dev-build-begin`,
`dev-build-complete`, `dev-build-failed`, `dev-reload-applied`. A failed build
leaves the previously loaded adapter running; a build that succeeds but produces
an adapter that fails to load leaves that application `unavailable` on the
dashboard until the next successful reload.

Both watchers poll (they do not use `fs.watch`) for the Docker bind-mount reason
described above, and a change must be seen identically twice before it is acted
on, so a half-written file is never built or imported. The expensive source scan
runs less often than the single-`stat` adapter check; a sibling's own `dist/`,
`node_modules/`, and other generated directories are excluded from the source
scan so a build cannot re-trigger itself.

These switches (development only — none of them exist in production) tune it:

| Variable | Default | Effect |
| --- | --- | --- |
| `HOMEBASE_DEV_HOT_RELOAD` | on | `off`/`false`/`0` disables watching entirely. |
| `HOMEBASE_DEV_AUTO_BUILD` | on | `off` keeps adapter reloads but stops HomeBase running sibling builds — use it when you run a sibling's own `--watch` build yourself. |
| `HOMEBASE_DEV_HOT_RELOAD_APPS` | all enabled | Comma-separated ids to watch, e.g. `lmeval,lmapi`. |
| `HOMEBASE_DEV_WATCH_INTERVAL_MS` | `1000` | Adapter-file poll interval. |
| `HOMEBASE_DEV_SOURCE_SCAN_INTERVAL_MS` | `2000` | Source-tree scan interval. |

`POST /api/applications/:id/reload` triggers the same reload by hand (it
re-imports what is on disk; it never builds), which is useful after building a
sibling yourself:

```sh
curl -X POST http://localhost:17106/api/applications/lmeval/reload
```

Known limitation: Node's ESM loader cannot unload a module, so every reload
leaves the previous adapter's module graph resident. That is a bounded,
development-only cost, but a very long session with many reloads will grow
HomeBase's memory — restart the dev container if it matters. For the same
reason nothing here is enabled in production.

#### Rebuilding by hand

`npm run rebuild:dev` remains available and is still the right tool when you
want an explicit, full install-and-build pass (or when the watcher is switched
off):

```sh
npm run rebuild:dev
```

For every **enabled** application in `config/homebase.json`, this installs
dependencies (`npm install`, matching the install step `ApplicationHost`
runs for each sibling as part of its own background load) in that
application's directory under `HOMEBASE_WORKSPACE_PATH`, then runs up
to two build scripts read from that app's own `package.json` — plain `build`
alone is not enough, since sibling repos split it:

- A frontend/general build: `build:hosted` if the app defines it (some apps,
  like DevPlanner, need this variant so built asset URLs are prefixed for
  their HomeBase `basePath` instead of assuming they're served from `/`),
  otherwise plain `build`.
- `build:host`, if defined — this is what actually compiles the hosted
  adapter HomeBase loads (`adapterPath`, e.g. `dist/host/index.js`; plain
  `build` does not produce it).

These are the same two scripts the development watcher above runs
automatically. Both are run when present; an app missing both is skipped with a warning
(nothing to rebuild). Before either build step, `npm run rebuild:dev` skips
`npm install` entirely for an app whose `package.json`/`package-lock.json`
haven't changed since its last successful install (tracked via a signature
file under that app's own `node_modules/`) — matching the skip-if-unchanged
behavior `ApplicationHost` already uses at HomeBase startup, so rebuilding
after an edit that doesn't touch dependencies (e.g. a frontend-only change)
doesn't pay for a redundant install. Afterward the `homebase-dev` container
is restarted so the freshly built adapters are re-imported. Pass `--app <id>` to rebuild a
single application (for example `npm run rebuild:dev -- --app devplanner`),
or `--no-restart` to rebuild without restarting. If the dev container isn't
running, the restart step warns instead of failing — the sibling is still
rebuilt on disk.

`npm run rebuild:prod` runs the same install-and-build pass with `npm ci`
instead of `npm install` (a clean, lockfile-reproducible install, matching
what a production deployment expects) and never restarts a container.

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
Git inspection and mutation, dependency installation, update and rollback
automation, audit controls, and advanced portal features require separate
expectation alignment and implementation plans. They must not be treated as
implemented or approved v1 behavior.

Cross-repository hot reload is now partially implemented, for development only:
sibling source watching, automatic sibling builds, and in-place adapter reload
ship as described in "Hot reload for hosted sibling applications" above. What
remains deferred is the production side of that capability and true frontend HMR
for a hosted application (a sibling's own Vite dev server proxied through
HomeBase, rather than a rebuilt static bundle served on refresh).
