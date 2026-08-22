# Dual-Mode Adapter Config Paths (Native + Docker)

**Status:** Proposed — not yet approved or scheduled for implementation.

**Depends on:** Phase 6 (container packaging, implemented) and the existing
native (non-Docker) run mode that predates it.

## Context

On 2026-08-22, DevPlanner started reporting `"unavailable"` /
`"initialize-failed"` in the Docker dev container while LMApi kept working.
Root cause: `config/homebase.json` (local, gitignored, bind-mounted read-only
into the container) sets DevPlanner's `adapterConfig.workspacePath` and
`fileBrowserBasePath` to raw Windows host paths
(`C:\Drive\Drive\Development\AgentKanbanWorkspace`, `C:\Drive\AgentVault`).
Those paths are correct when HomeBase runs natively on Windows, but don't
exist inside the Linux container — the container instead has the same host
directories bind-mounted at `/mnt/devplanner-workspace` and
`/mnt/devplanner-vault` (see `docker-compose.yml`, `docker-compose.dev.yml`).
DevPlanner's adapter (`DevPlanner/src/host/config.ts`) requires
`workspacePath` and fails `initialize()` when it can't find it, which
`ApplicationHost.ts` then surfaces as "unavailable."

The immediate fix (already applied) was to hardcode the container mount
paths into the local `config/homebase.json`. That's correct only as long as
HomeBase runs exclusively in Docker. The user wants to keep running HomeBase
both ways going forward — natively on the host and in Docker — without
manually flipping `adapterConfig` paths back and forth every time. This plan
is where that dual-mode support should be designed, once prioritized.

## Problem to solve

`config/homebase.json` is one file, used as-is by both:
- native (non-Docker) execution, where filesystem paths are host paths
  (e.g. Windows paths like `C:\Drive\...`)
- Docker execution, where the same host directories are visible only under
  the container's bind-mount targets (e.g. `/mnt/devplanner-workspace`)

Any `adapterConfig` field that is a filesystem path (today: DevPlanner's
`workspacePath`, `artifactBasePath`, `fileBrowserBasePath`; potentially
similar fields for other hosted apps in future) needs to resolve to a
different concrete value depending on which mode HomeBase is running in,
without requiring two divergent copies of `config/homebase.json` that can
drift out of sync.

## Directions to evaluate (not decided)

1. **Runtime-mode env var + path table.** Introduce something like
   `HOMEBASE_RUNTIME_MODE=docker|native`. `docker-compose.yml` /
   `docker-compose.dev.yml` already set `HOMEBASE_WORKSPACE_PATH=/workspace`
   for the general workspace root and `.env.docker` already carries the host
   paths (`HOMEBASE_HOST_DEVPLANNER_WORKSPACE_PATH`,
   `HOMEBASE_HOST_DEVPLANNER_VAULT_PATH`). Native mode has no equivalent env
   vars today. Could extend this pattern so per-application adapter path
   fields are supplied via env vars (mapped per mode) rather than literal
   strings baked into `homebase.json`.

2. **Path-prefix substitution in `ConfigService.ts`.** At config
   normalization time (`normalizeApplications` /
   `ConfigService.ts`), detect known host-path prefixes in `adapterConfig`
   and rewrite them to their container-mount equivalents when
   `HOMEBASE_WORKSPACE_PATH` indicates a Docker environment (e.g.
   `/workspace`). Keeps `config/homebase.json` as a single native-path
   source of truth; Docker-mode translation happens in code, driven by the
   same mount-mapping that `docker-compose.yml` already declares.

3. **Symlinks/mount into place instead of translating.** Rather than
   translating paths, mount the DevPlanner workspace/vault directories at
   the *same absolute path* inside the container as they have natively —
   avoids any code change, but may not be feasible cross-platform (Windows
   paths with drive letters and backslashes aren't valid Linux mount
   targets) and would need investigation.

Recommendation to weigh first: option 2 keeps `config/homebase.json`
single-sourced on native paths (least surprising for the common local/native
workflow) and reuses mount-mapping data Docker Compose already has; it needs
a clear, explicit list of which `adapterConfig` keys are filesystem paths
per application (not all of them are — e.g. DevPlanner's `artifactBaseUrl`
is a network URL, not a path, and must not be rewritten).

## Open questions for whoever picks this up

- Is DevPlanner the only hosted app with this path-portability need, or
  will LMApi/MemoryApi/LMEval eventually need similar `adapterConfig`
  filesystem paths as they grow?
- Should the translation be purely mechanical (prefix rewrite) or does each
  adapter need to declare which of its config keys are paths (schema-level,
  e.g. extending `DevPlanner/src/host/config.ts`'s zod schema with metadata)?
- Should this be validated at HomeBase startup (fail fast with a clear error
  if a path doesn't resolve in the current mode), matching the existing
  `ENABLED_ADAPTER_MISSING` / `ENABLED_REPOSITORY_MISSING` fail-fast pattern
  in `ConfigService.ts`?
- Migration: existing local `config/homebase.json` files (this one included)
  currently hold Docker-mode paths after today's fix — a dual-mode change
  must not silently break the file that's already working.

## Non-goals for this plan

- Does not re-litigate Phase 6's container/Tailnet packaging decisions.
- Does not change DevPlanner's own adapter contract
  (`DevPlanner/src/host/config.ts`) unless investigation shows the
  path-portability metadata is better owned there than in HomeBase.
