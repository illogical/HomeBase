# Phase 6: Container and Tailnet Rollout

**Status:** Implemented (see
[the container and Tailnet deployment doc](../features/2026-08-16-container-and-tailnet-deployment.md)
for the verification record; second-device Tailnet reachability is pending
tailnet-admin approval, tracked in `docs/TASKS.md`)

**Approved:** by implementation request, 2026-08-16

**Depends on:** Phases 1–4 (complete) providing the configuration runtime,
`ApplicationHost`, `/health`/`/ready`, and bounded shutdown this plan packages
and exposes. Does **not** depend on Phase 5 (candidate application migrations)
completing first — this plan uses fixture adapters and/or zero enabled
applications for its own verification, exactly as Phase 4 did, so container
packaging can be built and verified independently of any specific sibling
repository being migrated.

## Context

`docs/SPECIFICATION.md` §2.1–2.3 already commits HomeBase to running as one
Docker container with one Node process and one shared `http.Server`, publishing
its port on host loopback only, and relying on host-managed Tailscale Serve to
reach `https://home.<tailnet>.ts.net`. It deliberately leaves the concrete
mount locations, ownership, and read/write modes as "the first container
implementation plan will choose" (§2.3) — that plan is this one.
`docs/TASKS.md` lists Phase 6 as the container/Tailnet rollout with an explicit
acceptance gate (documented clean deployment reachable from localhost and a
second Tailnet device, unhealthy optional applications never make readiness
dishonest, and a documented rollback restores the previous deployment). No
Docker file of any kind exists in the repository yet, so this plan starts from
a clean slate and must make every packaging decision explicit rather than
inherit one.

## Goal and success criteria

Package HomeBase as one Docker image and container that a developer can build,
run, restart, and roll back locally (Windows host with Docker Desktop today;
the eventual Tailnet host may be Linux — this plan documents both), then prove
it is reachable through host-managed Tailscale Serve from a second Tailnet
device, per `docs/SPECIFICATION.md` §2 and the exact `docs/TASKS.md` Phase 6
acceptance gate. Success means:

- A multi-stage `Dockerfile` builds one Node 24 runtime image containing the
  compiled server and dashboard, running as a non-root user, with no dev
  dependencies or source TypeScript in the final image.
- `docker run`/`docker compose` publishes the effective port on host loopback
  only (`127.0.0.1:<port>:<port>`), never on `0.0.0.0` or the LAN interface.
- The workspace root and each application's writable data directory are bind
  mounts with explicit, documented paths, ownership, and read/write modes that
  preserve the existing workspace-relative path contract in
  `docs/SPECIFICATION.md` §2.3 (no code change to that contract, only concrete
  values for it).
- The container reports health/readiness the same way the existing `/health`
  and `/ready` routes already do (per §6, readiness is process/startup truth,
  not per-application truth) via a Docker `HEALTHCHECK`, and stops gracefully
  within HomeBase's own 20000 ms shutdown watchdog rather than being
  `SIGKILL`ed early by Docker's default stop timeout.
- Host-managed Tailscale Serve configuration is documented (commands and
  expected output), verified to proxy `https://home.<tailnet>.ts.net` to the
  published loopback port, and proven not to be mutated by any HomeBase
  startup, run, or shutdown behavior.
- Manual verification proves localhost access, a second Tailnet device's
  access, a restart (container and host reboot) recovering cleanly, a
  deliberately induced failure reporting honestly, and a documented rollback
  restoring the previous working image/config.
- The exact `docs/TASKS.md` Phase 6 acceptance gate passes and is recorded.

## Current implementation and boundaries

- No `Dockerfile`, `docker-compose.yml`, `.dockerignore`, or any other
  container file exists anywhere in the repo today.
- `src/services/ConfigService.ts` already validates `HOMEBASE_WORKSPACE_PATH`
  and `HOMEBASE_DATA_PATH` as required, absolute, existing directories
  (`resolveExistingDirectory`, lines 191–229) and resolves every application's
  `repositoryRoot`/`adapterFile`/`dataPath` beneath them with symlink-safe
  containment checks (`resolveContained`, `validateCanonicalContainment`).
  This plan supplies concrete in-container path *values* for those two
  environment variables; it does not change `ConfigService` itself.
- `src/startServer.ts`'s `listenWithExpress` (lines 88–102) calls
  `server.listen(port)` with no host argument, which binds all interfaces
  inside the container's own network namespace. `docs/SPECIFICATION.md` §2.2
  ("Docker must publish the effective port on host loopback") is satisfied at
  the Docker publish-flag layer (`-p 127.0.0.1:<port>:<port>`), not by an
  in-process bind-address change, because Docker's default bridge network
  requires the container process to listen on all of its own interfaces for
  the port-publish mechanism to work at all. This plan keeps that division of
  responsibility and states it explicitly rather than adding a new
  `HOMEBASE_HOST` variable — there is no product requirement driving an
  in-process bind restriction once the host-loopback publish is correct.
- `src/routes/health.ts` already returns unconditional `200` from `/health`
  and `/ready` once the process is listening; per §6 this is deliberately not
  wired to `ApplicationHost` per-application state, so "unhealthy optional
  applications do not make HomeBase readiness dishonest" already holds by
  construction. This plan reuses those routes for the container `HEALTHCHECK`
  verbatim — no HomeBase code change is needed to satisfy that acceptance-gate
  clause.
- `src/shutdownSignals.ts` and `ApplicationHost.shutdown()` already implement
  bounded, idempotent, reverse-order shutdown with a 20000 ms watchdog
  (`docs/plans/2026-08-15-phase-4-hosted-architecture-proof.md`, "Shutdown"
  subsection). Docker's default `docker stop` grace period is 10 s, shorter
  than the watchdog — this plan sets an explicit longer stop timeout so
  HomeBase's own bounded shutdown, not `SIGKILL`, is what actually completes
  it under normal operation.
- `package.json` `build` produces `dist/` (server) and `dist/dashboard`
  (Vite output) via `npm run clean && npm run build:server && npm run
  build:dashboard`; `start` runs `node --env-file-if-exists=.env dist/main.js`.
  `engines.node` is `>=24 <25`, matching `SUPPORTED_NODE_MAJOR` enforced at
  runtime.
- Out of scope for this plan: any change to `ConfigService`'s validation
  rules, the hosted-adapter contract, or `/health`/`/ready` route logic;
  real sibling-application migration (Phase 5, independent of this plan);
  in-container Tailscale/sidecar processes (explicitly excluded by §2.2 —
  Tailscale stays host-managed); CI/CD image publishing to a registry (this
  plan covers local build/run/rollback only, consistent with the current
  single-operator deployment target); per-user auth, TLS termination inside
  the container (Tailscale Serve already terminates TLS on the host), and any
  Kubernetes/orchestrator beyond `docker run`/Docker Compose.

## Architecture and decisions

### Dockerfile: multi-stage build

Add a repository-root `Dockerfile` with two stages:

1. **`build`** stage, `FROM node:24-slim AS build`: `WORKDIR /app`, copy
   `package.json`/`package-lock.json`, `npm ci` (full dependency set,
   including dev deps needed for `tsc`/`vite`), copy the rest of the source,
   run `npm run build`. Produces `dist/` (server) and `dist/dashboard`
   (static assets) plus `node_modules`.
2. **`runtime`** stage, `FROM node:24-slim AS runtime`: `WORKDIR /app`, copy
   `package.json`/`package-lock.json`, `npm ci --omit=dev` (production
   dependencies only — `express`, `ajv`, `socket.io`, `ws`; `react`/`react-dom`
   stay dev-time build inputs for Vite and are not needed at runtime since the
   dashboard ships as static output), then `COPY --from=build /app/dist ./dist`
   and `COPY --from=build /app/config ./config` (schema and example registry;
   the operational, ignored `config/homebase.json` is supplied via a bind
   mount at run time, matching the existing local-dev pattern). Create and
   switch to a non-root user (`node:24-slim` already ships a `node` user/group
   — use it via `USER node`) after any `chown` needed for
   `WORKDIR`/`node_modules`. Set `ENV NODE_ENV=production`.
   `EXPOSE <default port>` is documentation-only; the real port comes from
   `server.port`/`HOMEBASE_PORT` at runtime.
3. `ENTRYPOINT ["node", "dist/main.js"]` (bypasses `npm start`'s
   `--env-file-if-exists` — Docker/Compose injects environment variables
   directly, so no `.env` file is expected or required inside the image).
4. `STOPSIGNAL SIGTERM` (Node's default, but stated explicitly since
   `shutdownSignals.ts` specifically handles `SIGTERM`/`SIGINT`).
5. `HEALTHCHECK` using Node itself (no extra `curl`/`wget` package needed in
   the slim image) — a small inline script or a checked-in
   `scripts/healthcheck.mjs` that performs a plain `http.get` to
   `http://127.0.0.1:<port>/health` (reading the effective port from the same
   `HOMEBASE_PORT`/registry-default resolution the app uses, or simply reusing
   the container's own `HOMEBASE_PORT` env var since Compose/run always sets
   it explicitly in this plan) and exits `0`/`1` accordingly. `interval: 10s`,
   `timeout: 3s`, `retries: 3`, `start_period: 10s` (generous enough to cover
   the pre-listen `ConfigService`/`ApplicationHost` startup sequence).

Add a root `.dockerignore` excluding `node_modules`, `dist`, `coverage`,
`.git`, `.env*`, `config/homebase.json` (the operational, ignored registry —
never baked into the image), and editor/OS cruft, mirroring the existing
`.gitignore`.

### Port publishing: host loopback only

No in-process bind-address change (see "Current implementation and
boundaries" above). The container's own `EXPOSE`d port is published with
Docker's host-IP-qualified publish syntax:

```sh
docker run ... -p 127.0.0.1:17106:17106 ...
```

or, in Compose, `ports: ["127.0.0.1:${HOMEBASE_PORT:-17106}:${HOMEBASE_PORT:-17106}"]`.
This plan documents that omitting the `127.0.0.1:` host qualifier (bare
`-p 17106:17106`) publishes on all host interfaces and must never be used —
call this out explicitly in the deployment doc as the one most likely
copy-paste mistake.

### Volume mounts: workspace and data roots

Two bind mounts, both required, matching the existing environment-variable
contract exactly (`ConfigService` does not change):

| Host concept | Container path | Env var | Mode | Why |
| --- | --- | --- | --- | --- |
| Directory containing sibling repositories | `/workspace` | `HOMEBASE_WORKSPACE_PATH=/workspace` | **read-only** (`:ro`) | HomeBase only reads repository/adapter files through this root (`ConfigService.normalizeApplications`); no HomeBase or adapter code writes into `repoPath`/`adapterPath` locations per §2.3 ("Repository source and build output are distinct from mutable runtime data"). |
| HomeBase runtime-data root | `/data` | `HOMEBASE_DATA_PATH=/data` | **read-write** | HomeBase creates `<dataRoot>/homebase/log/` and `<dataRoot>/apps/<id>/` here (`ApplicationHost`/`RootLogger`); must already exist on the host before container start, exactly like local dev today (`ConfigService` rejects a missing directory). |

Ownership: the `runtime` stage's non-root `node` user has a fixed UID/GID
(1000:1000 on the standard `node` image). Document that the host must
`mkdir -p` the data directory and ensure it is writable by UID 1000 before
first run (`chmod 775` plus matching group, or `chown 1000:1000`, is the
simplest documented option; a rootless/Podman alternative using
`--user "$(id -u):$(id -g)"` combined with a matching in-container `HOME`/UID
mapping is noted as an alternative but not the default path, since Docker
Desktop on Windows/WSL2 — the current dev host — already remaps this
transparently). The workspace mount only needs to be host-readable, no
special ownership required since it is mounted read-only.

The operational `config/homebase.json` (already Git-ignored) is supplied as a
third, small bind mount: `-v <host path to homebase.json>:/app/config/homebase.json:ro`.
This keeps the image identical across environments and matches the existing
"ignored, local registry" pattern from Phases 1–4.

### Compose file for reproducible local/Tailnet-host runs

Add `docker-compose.yml` at the repository root encoding the above: build
context `.`, the two/three mounts, the loopback-only port publish, `env_file`
pointing at a host `.env.docker` (new, documented, git-ignored — distinct from
the dev-only `.env` since Compose interprets `.env` specially and this plan
avoids that collision), `restart: unless-stopped`, and
`stop_grace_period: 25s` (comfortably above HomeBase's own 20000 ms shutdown
watchdog so `docker compose stop`/`down` lets the application's own bounded
shutdown finish before Compose escalates to `SIGKILL`). Document the
equivalent plain `docker run ... --stop-timeout 25 ...` form for operators who
prefer not to use Compose.

### Health, readiness, and graceful stop

No application code changes. `/health` and `/ready` already behave correctly
for this purpose (see "Current implementation and boundaries"); this plan
only wires Docker's `HEALTHCHECK` to `/health` (process/event-loop liveness —
the correct signal for container restart policies) and documents that
`/ready` remains available for a future orchestrator readiness probe or manual
verification, without conflating either with per-application state from
`GET /api/applications`. `docker stop`/`docker compose stop` send `SIGTERM`,
already handled by `shutdownSignals.ts`; the documented `--stop-timeout`/
`stop_grace_period` values (above) ensure Docker waits long enough for
HomeBase's own watchdog rather than force-killing it first.

### Host-managed Tailscale Serve documentation

Add a new `docs/features/2026-08-16-container-and-tailnet-deployment.md`
(or fold into a `docs/DEPLOYMENT.md` — decide during Phase 3 review, see plan
review section below) documenting, as commands plus expected output, not new
product behavior:

1. Prerequisite: Tailscale already installed and logged in on the host,
   outside any container, per §2.2.
2. Bring up the HomeBase container (`docker compose up -d`), confirm
   `http://localhost:<port>/health` and `/ready` return `200` from the host.
3. Configure host-managed Tailscale Serve to proxy the Tailnet HTTPS endpoint
   to the published loopback port, e.g.
   `tailscale serve --bg --https=443 http://127.0.0.1:<port>` (exact flags
   confirmed against the operator's installed Tailscale CLI version during
   implementation, since Serve's flag surface has changed across releases —
   this plan records the *intent* and defers the exact command syntax to
   implementation-time verification against the real CLI, per AGENTS.md
   "revalidate... before relying on them").
4. Verify `tailscale serve status` shows the mapping, and that HomeBase
   startup/shutdown does not alter it (start/stop the container, re-run
   `tailscale serve status`, confirm no change) — this directly proves the
   §2.2 "must not mutate host Tailscale configuration" constraint, since
   HomeBase has no code path that could invoke `tailscale` at all; the
   verification step exists to catch any future regression, not because
   current code is suspected of doing so.
5. From a second Tailnet-joined device, browse to
   `https://home.<tailnet>.ts.net/` and confirm the dashboard loads and
   `/health`/`/ready` respond, proving the full external path.
6. Document teardown: `tailscale serve reset` (or the equivalent scoped
   removal of just this mapping) and `docker compose down`, independently, so
   either can be undone without the other.

### Rollback procedure

Document, and rehearse once during manual verification:

1. Keep the previous working image tagged (e.g. `homebase:previous` set via
   `docker tag homebase:latest homebase:previous` before rebuilding, or a
   content-addressed/timestamp tag if preferred) before rebuilding for a new
   change.
2. Rollback = `docker compose down` (or `docker stop`/`rm` for the plain
   `docker run` path) followed by re-running with the previous image tag and
   the same mounts/env — no data migration is needed since `<dataRoot>` and
   `config/homebase.json` are both external to the image and untouched by a
   rollback.
3. If a rollback is needed after a Tailscale Serve config change, restore its
   previous mapping independently (§2.2 keeps these two rollback paths
   deliberately separate — a HomeBase rollback must never require touching
   Tailscale, and vice versa).
4. Verify: `docker ps` shows the previous image running, `/health`/`/ready`
   respond, and the Tailnet URL still resolves.

## Implementation sequence

1. Add `Dockerfile` (multi-stage, as specified above) and `.dockerignore`.
2. Add `scripts/healthcheck.mjs` (or inline `HEALTHCHECK` shell form if
   simpler once implementation confirms the slim image has no `curl`/`wget`)
   and wire it into the `Dockerfile`'s `HEALTHCHECK` instruction.
3. Add `docker-compose.yml` and a tracked `.env.docker.example` (mirroring the
   existing `.env.example` pattern) documenting `HOMEBASE_WORKSPACE_PATH=/workspace`,
   `HOMEBASE_DATA_PATH=/data`, `HOMEBASE_PORT`, and the two/three bind-mount
   host paths as placeholders; add `.env.docker` to `.gitignore`.
4. Build locally: `docker build -t homebase:dev .`, confirm image size and
   layers are reasonable (no dev dependencies, no source `.ts` files, no
   `.git`) via `docker history`/`docker run --rm homebase:dev ls -la`.
5. Run locally with a scratch workspace and data directory (can reuse the same
   ones used for local `npm run dev`/`npm start` verification in earlier
   phases, or a fresh scratch pair), enabling zero or one fixture adapter
   (`test/fixtures/adapters/`) — real sibling-application migration is Phase
   5's concern, not required to verify container packaging.
6. Manually verify (see Test and acceptance plan) localhost access, container
   restart, `docker stop` timing against the shutdown watchdog, and a
   deliberately broken bind mount (missing/wrong-permission data directory)
   producing the existing, unchanged `ConfigurationError` startup failure
   visible in `docker logs`.
7. Write the Tailscale Serve documentation (new doc, see above) and verify it
   command-by-command against the real host Tailscale installation, including
   from a second Tailnet device.
8. Rehearse the rollback procedure once end-to-end (tag, roll forward with a
   trivial change, roll back, verify).
9. Update `README.md`: replace the "Phase 3 does not include Docker
   packaging... deferred to Phase 6" language with real instructions once
   implemented, add the Docker/Compose quick-start alongside the existing
   local `npm` quick-start, and link the new Tailnet-deployment doc.
10. Update `docs/SPECIFICATION.md` §2.3 only if implementation reveals the
    chosen mount modes need a stated correction to the "read/write modes"
    sentence already there (expected to be additive/confirmatory, not
    contradicting, since this plan's read-only workspace / read-write data
    split is exactly what §2.3 already implies).
11. Update `docs/TASKS.md`: link this plan from Phase 6, check off completed
    items as their evidence passes, mark Phase 6 `Done` only once the full
    acceptance gate passes.

## Test and acceptance plan

### Automated / build-time checks

- `docker build .` succeeds from a clean checkout with no local `node_modules`.
- `docker run --rm homebase:dev node -v` reports a Node 24.x runtime matching
  `engines.node`.
- Image contents check: no `*.ts` source files, no `devDependencies` packages,
  no `.git` directory, no `config/homebase.json` present inside the built
  image (`docker run --rm homebase:dev sh -c "test -f config/homebase.json"`
  must fail).
- Existing `npm test`/`npm run typecheck`/`npm run build` continue to pass
  unmodified (this plan adds no application source changes).

### Manual verification (required — this phase's acceptance gate is explicitly
runtime/deployment behavior, not unit-testable)

- `docker compose up -d` with a real scratch workspace/data pair; confirm
  `http://localhost:<port>/` (dashboard), `/api/applications`, `/health`, and
  `/ready` all respond correctly from the host, and that the port is **not**
  reachable from another machine on the LAN (attempt from a second local
  device against the host's LAN IP and confirm connection refused/timeout).
- `docker inspect` confirms the health check reports `healthy` after
  `start_period` elapses.
- `docker stop <container>` (or `docker compose stop`) timed against the log
  output: confirm HomeBase's own `shutdown-begin`/disposal/`shutdown-complete`
  sequence (NDJSON log, per Phase 4) completes before Docker's stop timeout
  would otherwise `SIGKILL` it; confirm no `MaxListenersExceededWarning` or
  forced-exit log line under normal (non-hung-adapter) conditions.
- Kill the container abruptly (`docker kill`) and restart it; confirm clean
  startup with no leftover lock state (there is none by design — `<dataRoot>`
  files are append-only/idempotent-create).
- Deliberately misconfigure one bind mount (missing data directory, or a
  data directory owned by a different UID with no group-write) and confirm
  the container exits with the same actionable `ConfigurationError` message
  visible via `docker logs`, not a silent hang or an opaque crash.
- Tailscale Serve: bring the mapping up per the documented commands, confirm
  `https://home.<tailnet>.ts.net/` loads the dashboard and
  `/health`/`/ready` respond from **a second physically separate Tailnet
  device** (not the host itself); start/stop the HomeBase container and
  re-check `tailscale serve status` is unchanged; tear down the Serve mapping
  independently of the container and confirm the container keeps serving on
  localhost.
- Rollback rehearsal: tag current image as `previous`, make a trivial change
  and rebuild/redeploy as `latest`, confirm the new behavior, then roll back
  to `previous` and confirm the prior behavior returns with no data loss
  (`<dataRoot>` log/app directories untouched throughout).
- Full host reboot (or Docker Desktop restart) with `restart: unless-stopped`
  configured: confirm the container comes back up automatically and is
  healthy without manual intervention.

## Deployment, rollback, and assumptions

- New files only: `Dockerfile`, `.dockerignore`, `docker-compose.yml`,
  `.env.docker.example`, `scripts/healthcheck.mjs` (if a separate script is
  used), and the new Tailnet-deployment doc. No existing source file changes
  are expected; `README.md`/`docs/SPECIFICATION.md`/`docs/TASKS.md` updates
  are documentation-only.
- No new required application environment variable beyond the two that
  already exist (`HOMEBASE_WORKSPACE_PATH`, `HOMEBASE_DATA_PATH`) — this plan
  only supplies concrete container-side path values and mount modes for them.
- Rollback of this plan's own changes (if the container approach itself needs
  reverting, distinct from the deployment-rollback procedure it documents):
  delete the new Docker/Compose files and the new deployment doc; no schema,
  data, or code migration is at risk since nothing here touches
  `ConfigService`, the hosted-adapter contract, or persisted data shape.
- Assumes Docker Desktop (Windows dev host today) and a Linux Docker Engine
  (eventual Tailnet host) both honor the same `Dockerfile`/Compose file
  without platform-specific branches; the plan calls out the one place
  (non-root UID/data-directory ownership) most likely to need a
  platform-specific note during implementation and documents both the default
  and the rootless/Podman alternative rather than silently picking one.
- Assumes Phase 5's real sibling-application migrations are **not** required
  for this plan's own verification (fixture adapters or zero enabled
  applications suffice, exactly as Phase 4 proved import/mount safety without
  a real repository) — but the acceptance gate's spirit (a real deployment
  useful to the user) is only fully realized once at least one Phase 5
  migration is also complete; this plan states that honestly rather than
  overclaiming end-user readiness.
- Assumes the operator's Tailscale CLI is already installed, authenticated,
  and has Serve capability enabled on the tailnet's ACL policy — verifying or
  changing tailnet ACL policy is out of scope for this plan.
