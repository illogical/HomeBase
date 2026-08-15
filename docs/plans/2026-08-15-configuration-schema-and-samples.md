# Compact HomeBase Configuration Schema and Samples

**Status:** Complete

**Approved:** 2026-08-15

**Completed:** 2026-08-15

## Goal

Create a usable v1 JSON Schema, a safe tracked example, and a local ignored
registry for the four initial HomeBase applications. Keep the configuration flat
and substantially simpler than the prior SourceManager service registry.

Success means the artifacts parse and satisfy the documented structural rules,
HomeBase defaults to port `17106`, the public example contains no internal
project metadata, and the local registry is excluded from Git.

## Boundaries and decisions

- HomeBase replaces SourceManager; SourceManager is not a hosted application.
- The registry has one `server.port`. It has no application-specific ports,
  health settings, allowed IPs, service arrays, or Tailscale controls.
- `HOMEBASE_PORT` overrides `server.port`; an invalid override must fail future
  startup rather than silently falling back.
- `HOMEBASE_CONFIG_PATH` may override the default `config/homebase.json` path.
- Application metadata remains flat. `defaultBranch`, `packageManager`,
  `devCommands`, and `tags` are optional and informational.
- HomeBase must never execute `devCommands` while loading configuration.
- All four local application entries begin disabled because their hosted
  adapters do not yet exist.

Runtime configuration loading, normalized TypeScript types, filesystem-aware
path checks, adapter loading, Docker packaging, and Tailnet deployment are out of
scope and remain separate unchecked tasks.

## Implementation

1. Add a Draft 2020-12 schema requiring `schemaVersion`, `server.port`, and the
   established application identity, routing, repository, adapter, enabled, and
   contract fields. Reject unknown fields and constrain optional metadata.
2. Add a tracked generic example with one disabled `example-app` and port
   `17106`.
3. Add an ignored local registry with disabled DevPlanner, LMApi, MemoryApi, and
   LMEval entries based on the supplied prior-project metadata.
4. Update the specification with the artifact paths, port/config precedence,
   compact field table, and a matching generic example.
5. Link this plan from Phase 1, mark the phase in progress, and check only the
   schema/sample task after validation.

## Validation and acceptance

- Parse the schema and both registries as JSON.
- Check required fields, identifiers, unique IDs/slugs, port range, relative
  paths, contract version, command arrays, and unique tags in both registries.
- Confirm the public example contains no internal application names or network
  metadata.
- Confirm the local file contains exactly the four intended disabled
  applications, excludes SourceManager, and uses port `17106`.
- Confirm Git ignores only the local registry and continues to see the schema
  and generic example.
- Run `git diff --check` and validate relative Markdown links.

Do not check the Phase 1 acceptance gate: no runtime configuration service or
full validation test suite exists yet.

## Rollback and remaining work

Rollback removes the two tracked configuration artifacts, this plan, the
specification/task changes, and the ignore rule. The ignored local registry can
be retained for later use or removed explicitly.

Phase 1 still needs the server scaffold, runtime configuration service,
filesystem-aware validation, normalized records, and automated rejection tests.

## Verification record

- Parsed the schema, public example, and local registry successfully as JSON.
- Verified both registries against the documented root, application, identifier,
  port, relative-path, contract, command-array, tag, and uniqueness rules.
- Verified the schema's regular-expression constraints compile under Node.js.
- Verified the public example contains one generic application and no internal
  application names or prior network-management fields.
- Verified the ignored local registry uses port `17106`, contains exactly the
  four intended disabled applications, and excludes SourceManager.
- Verified Git ignores `config/homebase.json` but not the schema or public
  example.
- Verified all relative Markdown links resolve and the scoped working-tree diff
  passes `git diff --check`.

The Phase 1 acceptance gate remains open because the runtime configuration
service and its automated validation suite have not been implemented.
