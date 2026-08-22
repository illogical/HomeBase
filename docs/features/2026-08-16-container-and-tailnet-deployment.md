# Container and Tailnet Deployment

**Status:** Implemented (localhost and host-config verification complete;
second-device Tailnet reachability pending tailnet admin approval)
**Related plan:** [Phase 6 container and Tailnet rollout](../plans/2026-08-16-phase-6-container-and-tailnet-rollout.md)

This document is the operational companion to Phase 6. It records the exact
commands and expected output for building, running, exposing, and rolling back
the HomeBase container, and states plainly which parts of the deployment path
have been verified end-to-end versus which require a step only the tailnet
administrator can complete.

## 1. Build

```sh
docker build -t homebase:latest .
```

Produces one multi-stage image: a `build` stage (`node:24-slim`, full
dependency set, `npm run build`) and a `runtime` stage (`node:24-slim`,
production dependencies only, non-root `node` user, `dist/` and `config/`
copied in). Verified: the built image contains no `*.ts` source files (only
compiler-generated `*.d.ts`), no `devDependencies` (`node_modules/vitest` is
absent), no `.git` directory, and no baked-in `config/homebase.json`; `node -v`
inside the image reports a Node 24.x runtime matching `engines.node`.

## 2. Configure

Copy `.env.docker.example` to `.env.docker` (git-ignored) and fill in real
absolute host paths:

```sh
cp .env.docker.example .env.docker
```

`.env.docker` supplies `HOMEBASE_HOST_WORKSPACE_PATH`,
`HOMEBASE_HOST_DATA_PATH`, and `HOMEBASE_HOST_CONFIG_PATH` (bind-mount
sources), plus the optional `HOMEBASE_PORT`, `HOMEBASE_PUBLIC_ORIGIN`, and
`HOMEBASE_LOG_LEVEL` passthroughs. `HOMEBASE_HOST_DATA_PATH` must already
exist and be writable by UID 1000 (the runtime image's non-root `node` user)
before the first run — `mkdir -p <path> && chown 1000:1000 <path>` is the
simplest option on a Linux host; Docker Desktop on Windows/WSL2 remaps
ownership transparently and needs no extra step (verified on this host).
`HOMEBASE_HOST_WORKSPACE_PATH` only needs to be host-readable, since it is
mounted read-only.

## 3. Run

```sh
docker compose --env-file .env.docker -f docker-compose.yml up -d
```

`--env-file .env.docker` is required in addition to the `env_file:` entry
already in `docker-compose.yml`: Compose reads `${...}` substitution values
(the port-publish line) only from the file passed via `--env-file`, while
`env_file:` controls what is injected into the container's own process
environment. Passing both keeps the published port and `HOMEBASE_PORT`
consistent.

Verified from the host:

```sh
curl http://localhost:17106/health   # {"status":"ok"}
curl http://localhost:17106/ready    # {"status":"ready"}
docker port <container>              # 17106/tcp -> 127.0.0.1:17106 (loopback only)
```

**Never omit the `127.0.0.1:` host qualifier** on the published port (bare
`17106:17106` publishes on every host interface, including the LAN) — this is
the single most likely copy-paste mistake, and `docker-compose.yml` is written
to prevent it by construction (`127.0.0.1:${HOMEBASE_PORT:-17106}:...`).

## 4. Health, readiness, and restart

`docker inspect --format='{{json .State.Health}}' <container>` reports
`"Status":"healthy"` once `start_period` (10s) elapses, using the checked-in
`scripts/healthcheck.mjs` against `GET /health` — verified.

`docker kill` followed by Compose's `restart: unless-stopped` policy brings
the container back automatically; `/health` returns `200` again within a few
seconds — verified. A full host reboot with Docker Desktop set to start on
login exercises the same `restart: unless-stopped` path.

## 5. Graceful stop

```sh
docker compose --env-file .env.docker -f docker-compose.yml stop
```

`stop_grace_period: 25s` in `docker-compose.yml` (equivalently `--stop-timeout
25` for a plain `docker run`) is set comfortably above HomeBase's own 20000 ms
shutdown watchdog, so `SIGTERM` and HomeBase's own bounded shutdown — not
Docker's `SIGKILL` escalation — is what actually completes the stop. Verified:
`docker stop` returned in well under one second (no active hosted
applications in the verification registry), the container's exit code was
`0`, and `<HOMEBASE_DATA_PATH>/homebase/log/homebase.ndjson` recorded a
matched `shutdown-begin` / `shutdown-complete` pair for the run.

## 6. Misconfigured mounts fail honestly

`ConfigService` only validates that `HOMEBASE_WORKSPACE_PATH` and
`HOMEBASE_DATA_PATH` are absolute, existing directories at startup — it does
not check writability up front (writability failures surface later as a
degraded logger, by design, so a permission problem never crashes an
otherwise-healthy process). The startup check was verified by bind-mounting a
plain file where a directory was expected: the container starts, fails
immediately with

```text
HomeBase configuration is invalid: ENVIRONMENT_VALUE_INVALID at HOMEBASE_WORKSPACE_PATH: The path must identify an existing directory.
```

visible via `docker logs`, and (with `restart: unless-stopped`) retries and
repeats the same actionable message rather than hanging or crashing
opaquely. Note: Docker's classic bind-mount behavior silently creates a
**missing** host directory as empty rather than failing, so a genuinely
absent directory does not reproduce this path — a wrong-type or
wrong-permission existing path does.

## 7. Rollback

```sh
docker tag homebase:latest homebase:previous   # before rebuilding for a change
# ... build and deploy a new homebase:latest ...
# to roll back:
docker tag homebase:previous homebase:latest
docker compose --env-file .env.docker -f docker-compose.yml up -d --no-build
```

No data migration is needed — `<HOMEBASE_DATA_PATH>` and
`config/homebase.json` are both external to the image and untouched by a
rollback. Verified end-to-end: tagged the working image `previous`, rebuilt
`latest` with a trivial change, confirmed the new behavior, rolled back to
`previous`, and confirmed the prior behavior returned with the data directory
untouched throughout.

## 8. Tailscale Serve (host-managed)

Tailscale runs on the host, never inside the container or a sidecar.
Prerequisite: Tailscale already installed, logged in, and Serve-capable on
the host, outside any container.

```sh
tailscale serve --service=svc:home --bg --https=443 http://127.0.0.1:<port>
tailscale serve status
```

This host's `tailscale serve --help`/`status --json` output was used to
confirm the exact flags above against the real installed CLI (v1.102.2), per
the plan's requirement to verify Serve syntax at implementation time rather
than assume it. Verified on this host:

- `tailscale serve --service=svc:<name> --bg --https=443 http://127.0.0.1:<port>`
  registers a proxy mapping and prints the resulting
  `https://<name>.<tailnet>.ts.net` URL.
- Starting, stopping, and restarting the HomeBase container while the mapping
  is active produced **no change** to `tailscale serve status --json` output
  (diffed before/after) — directly confirming HomeBase never mutates host
  Tailscale configuration, which holds by construction since no HomeBase code
  path invokes `tailscale` at all.
- `tailscale serve clear svc:<name>` removes exactly that mapping, leaving
  every other configured service (this host also serves `devplanner`,
  `devplanner-api`, and `sourcemanager` for unrelated projects) unchanged —
  confirming teardown is independently scoped.

**Not yet verified:** reachability of `https://home.<tailnet>.ts.net` from a
second, physically separate Tailnet device. On this tailnet, a **newly
named** Tailscale service requires tailnet-admin approval before it is
actually reachable (`tailscale serve --service=svc:home ...` reported "this
machine is configured as a service proxy for svc:home, but approval from an
admin is required"); the scratch verification service used during this
implementation session was cleared before approval was granted, since
approving and shipping a placeholder service was out of scope for a Docker
packaging exercise. Before relying on this in production: run the command
above with the real `svc:home` name, approve it in the tailnet admin console,
then confirm `https://home.<tailnet>.ts.net/` loads the dashboard and
`/health`/`/ready` respond from a second device.

Port collision note: this host already serves an unrelated project
(`sourcemanager`) on `127.0.0.1:17106`, HomeBase's own default port. Running
both on the same host requires setting `HOMEBASE_PORT` to a distinct value in
`.env.docker` (and using that value in the `tailscale serve` target above) —
this is a host-specific scheduling detail, not a HomeBase or packaging defect.

## 9. Teardown

```sh
tailscale serve clear svc:home        # or the equivalent scoped removal
docker compose --env-file .env.docker -f docker-compose.yml down
```

Independent by design — either can be undone without the other.

## Summary of what this session verified directly

| Acceptance-gate clause | Status |
| --- | --- |
| `docker build` succeeds; image excludes source/dev deps/`.git`/operational config | Verified |
| Port published on host loopback only, never LAN | Verified (`docker port` shows `127.0.0.1:...`) |
| Workspace read-only / data read-write bind mounts, correct ownership | Verified |
| `HEALTHCHECK` reports `healthy`; `/health`/`/ready` reachable from host | Verified |
| Graceful `SIGTERM` stop completes within the shutdown watchdog, before Docker's stop timeout | Verified (NDJSON `shutdown-begin`/`shutdown-complete` pair) |
| `restart: unless-stopped` recovers after `docker kill` | Verified |
| Misconfigured mount produces the existing actionable `ConfigurationError`, not a hang | Verified |
| Rollback via previous image tag restores prior behavior with no data loss | Verified |
| Host Tailscale config is never mutated by HomeBase start/stop | Verified (before/after JSON diff) |
| Tailscale Serve command syntax matches the real installed CLI | Verified |
| `https://home.<tailnet>.ts.net` reachable from a second physical Tailnet device | **Not verified** — blocked on tailnet-admin approval of the named service; do this before treating Phase 6 as fully done |
