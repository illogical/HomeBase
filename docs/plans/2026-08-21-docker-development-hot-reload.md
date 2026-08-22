# Docker Development Mode with Hot-Reload

**Status:** Proposed

**Depends on:** Phase 6 (container packaging, complete) — this plan adds a
second, dev-only build target and compose file alongside the existing
production `Dockerfile`/`docker-compose.yml`; it does not change or replace
anything Phase 6 shipped.

## Context

HomeBase's only containerized path today is production: `docker compose up
-d` builds the `runtime` stage of `Dockerfile`, whose entrypoint is `node
dist/main.js` serving a static `dist/dashboard` bundle that was compiled into
the image at `docker build` time (`src/dashboardHost.ts`'s
`initializeProductionDashboard`). Editing `src/**` or `dashboard/src/**` on
the host has no effect on a running container in this mode — there is no file
watching, no HMR, and no way to see a code change without a full `docker
compose build && docker compose up -d`, which takes long enough to break the
edit-verify loop a developer expects.

Locally (outside Docker), `npm run dev` already solves this: `src/dev.ts`
calls `startServer({ mode: "development" })`, which
`initializeDevelopmentDashboard` in `src/dashboardHost.ts` wires up as Vite in
middleware mode with `hmr: { server }` — Vite's HMR websocket shares the same
HTTP server/port as the Express app, no second port needed. `package.json`'s
`dev` script (`node --env-file-if-exists=.env --watch --import tsx
src/dev.ts`) layers Node's own `--watch` flag on top, which restarts the
whole process on `src/**.ts` (backend) changes while leaving
`dashboard/src/**` changes to Vite's own module graph — those only trigger
React Fast Refresh/CSS HMR, not a process restart, since Node's `--watch`
only tracks files it directly `require`/`import`s.

This plan brings that same experience into Docker: a container that runs
`src/dev.ts` instead of `dist/main.js`, with the repository bind-mounted in so
host edits are visible inside the container's file watchers, alongside the
existing production image unchanged.

## Goal and success criteria

- A developer can run one Compose command to start a HomeBase container in
  development mode, edit `dashboard/src/**` on the host, and see the browser
  update via HMR/Fast Refresh with no manual reload.
- Editing `src/**.ts` (backend) on the host restarts the containerized
  process automatically (Node `--watch`) and the app is reachable again
  immediately after.
- The existing production `Dockerfile` stages (`build`, `runtime`) and
  `docker-compose.yml` are unmodified and continue to build/run exactly as
  Phase 6 left them — dev mode is strictly additive.
- No HomeBase application source changes are required; this is packaging and
  tooling only, since `initializeDevelopmentDashboard`/`src/dev.ts` already
  implement the correct behavior for local (non-Docker) use.

## Current implementation and boundaries

- `src/dashboardHost.ts`'s `initializeDevelopmentDashboard` (lines 48–93)
  already does everything needed for HMR to work once the right process is
  running: it creates Vite in `middlewareMode: true` with `hmr: { server }`,
  mounts `vite.middlewares` on the shared Express `app`, and serves a
  transformed `index.html` — this is mode selection only
  (`DashboardMode`), triggered by `startServer({ mode: "development" })` in
  `src/dev.ts`. No change needed here.
- `package.json`'s `dev` script already expresses the correct watch
  boundary: Node's `--watch` (process-level restart) for `src/**.ts`, Vite's
  own watcher (in-process HMR) for `dashboard/src/**`. This plan reuses that
  script's command, not a new watcher.
- `Dockerfile`'s `runtime` stage (`node:24-slim`, `npm ci --omit=dev`, `COPY
  --from=build /app/dist ./dist`, non-root `USER node`) has no dev
  dependencies (`vite`, `tsx`, `typescript`, `@vitejs/plugin-react`) and no
  TypeScript source — by design, per the Phase 6 plan's "no dev dependencies
  or source TypeScript in the final image" success criterion. A dev-mode
  container therefore cannot reuse the `runtime` stage; it needs its own
  target with full `npm ci` (dev dependencies included) and either the
  source baked in or bind-mounted from the host.
- `docker-compose.yml` (Phase 6) already establishes the environment-variable
  and mount contract this plan reuses unchanged: `HOMEBASE_WORKSPACE_PATH`
  (read-only `/workspace`), `HOMEBASE_DATA_PATH` (read-write `/data`), the
  operational registry mount, `HOMEBASE_PORT`-driven host-loopback-only port
  publishing (`127.0.0.1:${HOMEBASE_PORT:-17106}:...`), sourced from
  `.env.docker` per `.env.docker.example`. This plan does not add any new
  required environment variable.
- Out of scope: any change to `ConfigService`, the hosted-adapter contract,
  `/health`/`/ready` route logic, or the production `Dockerfile`/Compose
  path; CI/CD; Tailscale Serve exposure of the dev container (dev mode is a
  localhost-only inner-loop tool, not a deployment target).

## Architecture and decisions

### Dockerfile: add a `dev` stage

Add a third stage to the existing multi-stage `Dockerfile`, independent of
`build`/`runtime`:

```dockerfile
# --- dev stage -----------------------------------------------------------
FROM node:24-slim AS dev
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

CMD ["node", "--watch", "--import", "tsx", "src/dev.ts"]
```

Notes:

- `npm ci` (no `--omit=dev`) installs `vite`, `tsx`, `typescript`,
  `@vitejs/plugin-react`, and the testing packages — everything `src/dev.ts`
  and Vite middleware mode need at runtime.
- No `COPY . .` and no `RUN npm run build` — `docker-compose.dev.yml` (below)
  bind-mounts the actual source at run time, and dev mode needs no build
  step at all (`tsx` runs TypeScript directly; Vite serves `dashboard/src`
  directly). This also makes `docker compose build` for the dev image fast
  and mostly cacheable (only `package.json`/`package-lock.json` invalidate
  the `npm ci` layer).
- `CMD` (not `ENTRYPOINT`) matches the `--watch --import tsx src/dev.ts`
  half of the existing `dev` npm script; the `--env-file-if-exists=.env`
  half is dropped because Compose injects environment variables directly
  into the container process, exactly the same reasoning already documented
  for the `runtime` stage's `ENTRYPOINT ["node", "dist/main.js"]`.
- This stage intentionally stays root (no `USER node`) — bind-mounting a
  Windows/WSL2 host directory into a non-root container user is a common
  source of write-permission friction (Vite/Node need to write nothing at
  runtime here, but `npm ci` running again inside the container, or any
  future dev-only tooling, would). This relaxation is scoped to the `dev`
  stage only and must never be copied into `runtime`.

### `docker-compose.dev.yml`: new, standalone file

Add a second Compose file at the repo root, not a merge override of
`docker-compose.yml` (mirroring how the existing file is already
standalone rather than composed from a base):

```yaml
services:
  homebase-dev:
    build:
      context: .
      target: dev
    image: homebase:dev
    env_file:
      - .env.docker
    environment:
      HOMEBASE_WORKSPACE_PATH: /workspace
      HOMEBASE_DATA_PATH: /data
    ports:
      - "127.0.0.1:${HOMEBASE_PORT:-17106}:${HOMEBASE_PORT:-17106}"
    volumes:
      - .:/app
      - homebase-dev-node-modules:/app/node_modules
      - ${HOMEBASE_HOST_WORKSPACE_PATH}:/workspace:ro
      - ${HOMEBASE_HOST_DATA_PATH}:/data:rw
      - ${HOMEBASE_HOST_CONFIG_PATH}:/app/config/homebase.json:ro
      - ${HOMEBASE_HOST_DEVPLANNER_WORKSPACE_PATH}:/mnt/devplanner-workspace:rw
      - ${HOMEBASE_HOST_DEVPLANNER_VAULT_PATH}:/mnt/devplanner-vault:rw

volumes:
  homebase-dev-node-modules:
```

Decisions:

- `build.target: dev` selects the new stage from the same `Dockerfile` —
  one Dockerfile, two independent images (`homebase:latest` for production,
  `homebase:dev` for this).
- `volumes: - .:/app` bind-mounts the whole repository so edits to
  `src/**`, `dashboard/src/**`, `config/`, etc. are visible inside the
  container immediately, with no rebuild.
- `volumes: - homebase-dev-node-modules:/app/node_modules` is required:
  without it, the bind mount above would shadow the container's own
  Linux-built `node_modules` (installed during `docker build`) with
  whatever `node_modules` exists on the Windows host filesystem — including
  any native/platform-specific binaries — which would break at container
  startup. The named volume keeps the image's own `node_modules` visible at
  that path regardless of what the host's `.:/app` mount contains there.
  This is the same problem `.dockerignore` solves for the `build`/`runtime`
  stages, applied to a live bind mount instead of a build context.
- Reuses `.env.docker`/`.env.docker.example` unchanged — same
  `HOMEBASE_HOST_WORKSPACE_PATH`, `HOMEBASE_HOST_DATA_PATH`,
  `HOMEBASE_HOST_CONFIG_PATH`, `HOMEBASE_HOST_DEVPLANNER_*`, and
  `HOMEBASE_PORT` variables as production, so a developer does not maintain
  two separate env files.
- Port publishing stays host-loopback-only, identical to
  `docker-compose.yml`, for the same reason (never expose the dev
  container beyond localhost either).
- No `restart:` policy (development container, restarted manually by the
  developer) and no `HEALTHCHECK`/`stop_grace_period` tuning beyond what the
  image already declares via the (unaffected) `Dockerfile`
  `HEALTHCHECK` instruction — `/health` behaves identically in development
  mode, so the existing check is reused as-is.

### File-watch propagation across the bind mount

Node's `--watch` and Vite's `chokidar`-based watcher both default to native
filesystem events (`fs.watch`/`inotify`). Docker Desktop's WSL2 backend
generally forwards native change events correctly for bind mounts on current
versions, but this is the one part of this plan that must be verified
empirically against the developer's actually-installed Docker Desktop
version during implementation, rather than assumed — consistent with how the
Phase 6 plan treated Tailscale CLI flag syntax as "confirmed against the real
CLI at implementation time," not guessed in advance. If native events do not
propagate reliably across the mount, the documented fallback is polling:
`CHOKIDAR_USEPOLLING=true` (environment variable, picked up by Vite's
`chokidar` internals) and Vite's own `server.watch.usePolling: true` in
`vite.config.ts` (guarded so it only applies when actually needed, e.g. via
an env-conditional in the Vite config, so the default non-Docker `npm run
dev` path is unaffected). This plan documents the fallback but does not
enable it by default, since enabling polling unconditionally would add
CPU overhead and latency to every developer's local (non-Docker) workflow.

### Interaction with the production container

`docker-compose.dev.yml` and `docker-compose.yml` publish the same host port
by default (`HOMEBASE_PORT`, default `17106`), so both cannot run
simultaneously without an explicit port override. This plan documents
`docker compose down` (stopping the production container) before starting
the dev one, or setting a distinct `HOMEBASE_PORT` for whichever is started
second, rather than adding new port-management logic.

## Implementation sequence

1. Add the `dev` stage to `Dockerfile` (as specified above), immediately
   after the existing `runtime` stage.
2. Add `docker-compose.dev.yml` at the repo root (build target, bind mount,
   `node_modules` named volume, env/port wiring as specified above).
3. Build: `docker compose -f docker-compose.dev.yml build`, confirm it
   succeeds and is fast on repeat builds (only source changes, not
   `package.json`, should not invalidate the `npm ci` layer).
4. Run: `docker compose -f docker-compose.dev.yml --env-file .env.docker up`
   against the same scratch workspace/data directories already used for
   Phase 6 verification (or a fresh scratch pair); confirm the dashboard
   loads at `http://localhost:<port>/`.
5. Verify dashboard HMR: edit `dashboard/src/App.tsx` or
   `dashboard/src/styles.css` on the host, confirm the browser updates
   without a manual reload and without the container process restarting
   (check container logs show a Vite HMR update, not a Node `--watch`
   restart).
6. Verify backend watch: edit a file under `src/` on the host, confirm the
   container logs show a Node `--watch` restart and the app is reachable
   again immediately after.
7. If step 5/6 shows file-change events are not propagating from the host
   through the bind mount, apply and document the polling fallback (see
   above), then re-verify.
8. Confirm `/health` and `/ready` still respond correctly and
   `docker inspect` still reports the container `healthy`.
9. Re-run a subset of the existing Phase 6 production verification
   (`docker compose build`, `docker compose up -d` against
   `docker-compose.yml`) to confirm the `dev` stage's addition to the
   `Dockerfile` has not changed the `build`/`runtime` stages' behavior or
   image contents.
10. Update `README.md`'s "Docker and Tailnet deployment" section with a new
    "Docker development mode" subsection documenting the dev quick-start
    command and the port-collision note above.
11. Update `docs/TASKS.md` to reference this plan (either as a Phase 6
    addendum or its own tracked line item, decided during review — this is
    developer tooling, not a Phase 6 acceptance-gate requirement, so it
    should not block or reopen Phase 6's own "Done" status).

## Test and acceptance plan

- `docker compose -f docker-compose.dev.yml build` succeeds from a clean
  checkout.
- `docker compose -f docker-compose.dev.yml --env-file .env.docker up`
  starts successfully; `/`, `/api/applications`, `/health`, and `/ready` all
  respond correctly from the host.
- Editing `dashboard/src/**` updates the browser via HMR/Fast Refresh with
  no manual reload, verified visually, and does not trigger a full
  container process restart.
- Editing `src/**.ts` triggers a Node `--watch` restart (visible in
  `docker compose logs`), and the app is reachable again immediately
  afterward with no manual `docker restart`.
- The dev container's port is not reachable from another machine on the
  LAN (same loopback-only check as Phase 6's production verification).
- `docker inspect` reports the dev container `healthy` once the
  `HEALTHCHECK` `start_period` has elapsed.
- The production image is unaffected: `docker build -t homebase:latest .`
  (or `docker compose build` against `docker-compose.yml`) still succeeds
  and produces an image with no dev dependencies or `.ts` source files,
  exactly as Phase 6 verified — proving the new `dev` stage is additive,
  not a regression of the `build`/`runtime` stages.

## Deployment, rollback, and assumptions

- New files/changes: one new `dev` stage appended to `Dockerfile`; one new
  `docker-compose.dev.yml`; a `node_modules` named volume created on first
  `up` (and removable via `docker compose -f docker-compose.dev.yml down
  -v` if it needs to be reset, e.g. after a dependency change). No changes
  to `docker-compose.yml`, `.env.docker.example`, or any application
  source under `src/`/`dashboard/src/`.
- Rollback: delete the `dev` stage from `Dockerfile` and delete
  `docker-compose.dev.yml`; the production image/path is untouched
  throughout, since it is built from a separate stage/target and never
  references the new file.
- Assumes Docker Desktop's WSL2 backend on the current Windows host
  propagates bind-mount file-change events with acceptable latency for
  interactive development; the polling fallback documented above exists
  specifically in case implementation reveals this assumption is wrong on
  the developer's actual setup.
- Assumes running one dev container at a time is sufficient (no need for
  multiple concurrent dev instances) — the shared `HOMEBASE_PORT` default
  and named volume are both scoped for a single-developer, single-instance
  workflow, matching how `npm run dev` is used locally today.
