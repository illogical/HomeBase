# Cross-platform configuration filesystem tests

**Status:** Complete

## Goal and success criteria

Make the Phase 1 configuration tests pass on both macOS and Windows without
weakening their coverage of registry read failures or canonical filesystem-link
containment. Success means the full test suite, typecheck, and production build
pass on Windows while the fixtures continue to use Node APIs supported on macOS.

## Scope

In scope:

- Replace the POSIX-permission-dependent unreadable-file fixture with a
  deterministic registry read failure supported by macOS and Windows.
- Create directory links using the platform-appropriate Node link type so the
  containment checks run without requiring Windows symbolic-link privileges.
- Re-run the Phase 1 acceptance checks and record the Windows result.

Out of scope:

- Changes to `ConfigService`, configuration contracts, or error codes.
- Changes to production filesystem behavior or path-containment policy.
- Claiming live macOS verification from the Windows development environment.

## Confirmed current behavior and decisions

`ConfigService` maps a failed registry or schema `readFile` call to
`CONFIG_FILE_READ_FAILED`. Windows does not enforce `chmod(0o000)` as a denial
of file reads, but reading a directory as a file fails with `EISDIR` on both
target platforms. The registry-read test will therefore select an existing
directory as `HOMEBASE_CONFIG_PATH` and retain the same public error assertion.

The containment implementation canonicalizes existing path components with
`realpath`. Windows directory symlinks can require elevated privileges, while
directory junctions do not in this environment and are also resolved by
`realpath`. The link fixture will request `junction` on Windows and `dir` on
other platforms. Both represent an existing directory link that resolves beyond
the configured parent, preserving the security assertion.

## Implementation

1. Remove the unused permission-changing import and rewrite the registry-read
   failure test around an existing directory selected as the registry path.
2. Add a local platform-derived directory-link type and use it for both the
   repository and adapter escape fixtures.
3. Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
4. Record the exact Windows verification result here and restore the Phase 1
   acceptance gate only if all required checks pass.

## Failure modes, compatibility, and rollback

The tests must still exercise the production error mapping and canonical escape
check; they must not skip either assertion on Windows. A junction target must be
absolute, which the temporary fixture already guarantees. macOS ignores the
Windows-specific `junction` distinction because the selected type there remains
`dir`.

Rollback is limited to reverting this plan, the task-index link/state update,
and the two fixture changes. No deployment or migration is required.

## Verification record

Verified on Windows 11 with Node.js `24.18.1` and npm `11.11.1`:

- `npm test` passed all 76 tests across five files.
- `npm run typecheck` passed the server and dashboard TypeScript configurations.
- `npm run build` passed the server compile and Vite production build.
- The Windows filesystem probe confirmed that the replacement directory read
  fails with `EISDIR` and a directory junction resolves to its external target.
- `git diff --check` passed for the completed change.

The updated fixtures use Node's supported `dir` link type on macOS, but no live
macOS run was available in this implementation session.
