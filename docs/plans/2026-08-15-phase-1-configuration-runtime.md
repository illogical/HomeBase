# Phase 1 Configuration Runtime Foundation

**Status:** Complete

**Approved:** 2026-08-15

**Completed:** 2026-08-15

## Goal

Complete the remaining Phase 1 work by scaffolding the Node 24, TypeScript, and
Express 5 server around an early `ConfigService`. The service is the single
source of effective runtime configuration, combining defaults, the selected
`homebase.json`, and environment overrides into a validated immutable object
model supplied to dependants through constructor injection.

Success means a clean build and test run proves that valid configuration loads
deterministically, unsafe or incompatible configuration prevents listening with
actionable errors, and configuration loading neither discovers nor executes
application code.

## Boundaries and decisions

- Configuration precedence is built-in defaults, JSON registry values, then
  environment variables (including values loaded from an optional root `.env`).
- Built-in defaults are port `17106`, `config/homebase.json`, schema version `1`,
  hosted contract version `1`, Node major `24`, and an initially empty
  application collection. Defaults never hide a missing or invalid registry.
- `HOMEBASE_WORKSPACE_PATH` has no default. It is required and absolute because
  host and container paths differ.
- Relative `HOMEBASE_CONFIG_PATH` values resolve from the HomeBase project root,
  not the process working directory.
- One fully initialized `ConfigService` is created at the composition root and
  passed to dependant classes through constructor injection. There is no global
  singleton and no other class reads environment variables or registry files.
- Enabled applications require an existing repository directory and compiled
  adapter file, but configuration loading never imports the adapter. Disabled
  applications may reference unbuilt output if all existing path components
  remain contained.
- Health/readiness routes, public APIs, adapter loading, application lifecycle,
  Docker packaging, Tailnet configuration, and graceful shutdown are out of
  scope.

## Implementation

1. Scaffold the Node 24 npm project with strict TypeScript, Express 5, Ajv Draft
   2020-12 validation, Vitest, development/start/build/typecheck/test scripts,
   and a committed lockfile. Keep Express construction separate from listening.
2. Add readonly configuration types and `src/services/ConfigService.ts` with a
   private constructor and asynchronous `load` factory. Expose focused accessors
   for server settings, resolved paths, applications, and ID lookup; deep-freeze
   all published data and preserve registry order.
3. Load the selected JSON registry, validate its full schema, then enforce
   runtime compatibility, uniqueness, reserved-route, lexical containment,
   canonical/symlink containment, and enabled-output existence rules. Use stable
   error codes and field-level issues without exposing raw environment data.
4. Use Node's optional `.env` loading in local npm scripts. Add a tracked
   `.env.example` while retaining the existing ignore policy for local variants.
5. Document the host-versus-container workspace-path contract, configuration
   precedence, and project-root-relative registry selection. Link this plan from
   Phase 1 and update task state only as verification succeeds.

## Tests and acceptance

- Verify default, registry, and environment precedence; stable path resolution;
  immutable normalized results; registry-order preservation; application lookup;
  and shared constructor-injected service identity.
- Cover missing, unreadable, malformed, and schema-invalid registries; invalid
  environment values; incompatible schema/contract/Node versions; duplicates;
  reserved or malformed slugs; invalid optional arrays; and every unsafe path
  category, including symlink escapes and missing enabled output.
- Prove disabled unbuilt applications remain valid, commands are not executed,
  folders are not discovered, and startup never listens after validation fails.
- Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, JSON parsing,
  ignore checks, Markdown-link validation, and `git diff --check`.
- Check the Phase 1 acceptance gate and mark the phase `Done` only when the full
  validation succeeds. Record exact results and remaining limitations here.

## Deployment, rollback, and deferred work

Local development may set `HOMEBASE_WORKSPACE_PATH=/Users/matt/dev/projects` in
an ignored `.env`. A future container will mount that directory and set the same
variable to its container-visible path, such as `/workspace`. Docker-specific
files and examples remain Phase 6 work.

Rollback removes the runtime scaffold and reverts the documentation/task
updates. It does not modify the ignored `config/homebase.json` or a developer's
local `.env`.

## Verification record

- A clean `npm ci` under Node.js `24.19.0` installed 152 packages, audited 153,
  and reported no vulnerabilities.
- `npm run typecheck`, `npm run build`, and `npm test` passed under Node.js
  `24.19.0`; Vitest ran 50 tests across two files with no failures.
- The tests cover precedence, immutable normalization, registry-order
  preservation, constructor injection, default and overridden paths, schema and
  runtime incompatibility, duplicates, reserved and malformed routes, invalid
  environment values, lexical and symlink escapes, enabled-output requirements,
  adapter non-import, no discovery, and validation-before-listen behavior.
- A compiled-service smoke test loaded the ignored local registry at port
  `17106` with DevPlanner, LMApi, MemoryApi, and LMEval present and disabled.
- A real Node 24 process listened on temporary port `27106`; an HTTP request
  reached Express and received the expected `404` because Phase 1 intentionally
  defines no routes.
- The schema, examples, operational registry, npm manifests, and TypeScript
  configurations parse successfully. Markdown links, `.env`/registry ignore
  behavior, and `git diff --check` pass.

No Docker, Tailnet, hosted-adapter, health/readiness, or graceful-shutdown
behavior was exercised; those capabilities remain assigned to later phases.
