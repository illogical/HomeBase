# Git Status Dashboard Integration

**Status:** Proposed

**Depends on:** Phase 3 (configuration and status API, complete) and Phase 4
(hosted architecture proof, complete). This plan adds a new, independent
`/api/homebase` route namespace and a dashboard panel; it does not change the
existing `/api/applications` contract, the hosted adapter contract, or
`ApplicationHost`.

## Context

HomeBase's dashboard currently shows only adapter-derived lifecycle state
(ready/degraded/unavailable/etc.) for each application, via
`GET /api/applications`. There is no visibility into the underlying
repository backing each application: what branch is checked out, whether the
working tree is clean, or whether the local checkout is behind its upstream.
`docs/TASKS.md` Phase 7 already anticipates git visibility ("Read-only Git
checkout, upstream, build, and loaded-revision visibility") and pull ("Git
pull, dependency installation, build verification, restart, and rollback"),
but bundles both with build/install/restart work that is out of scope here.

The sibling project SourceManager
(`C:\LocalDev\Projects\SourceManager`) has a similar composition-root
architecture and already solved the read-only half of this problem
(`src/services/git.ts`): it shells out to the `git` CLI via
`node:child_process.execFile` to report branch, HEAD commit, and
clean/dirty working-tree state, with no external git library and no
authentication layer — it relies entirely on whatever git credential
helper/SSH agent is already configured on the host. SourceManager's own
`ProjectRuntimeStatus` type (`src/types.ts`) already models `workingTree:
"clean" | "dirty" | "unknown"`, `branch: string | null`, and
`checkedOutCommit: string | null`, but has **not** implemented ahead/behind
tracking, fetch, or pull — its Phase 6 task list
(`docs/features/unified-node-express-portal/tasks.md`) explicitly defers
that project-level git/update foundation to later.

This plan carries SourceManager's CLI-shelling pattern into HomeBase, adds
the ahead/behind-tracking and fetch/pull behavior SourceManager hasn't built
yet, and exposes it through a new `/api/homebase` route namespace plus a
dashboard panel — scoped to applications currently in the `ready` state, and
deliberately excluding build/install/restart, which stay deferred in Phase 8
(the renumbered "Deferred capabilities" phase).

### Decisions made during planning

- **Behind-count basis:** the checked-out branch's upstream tracking ref
  (`@{u}`), not a fixed comparison to the registry's optional
  `defaultBranch` field. If no upstream is configured (detached HEAD,
  local-only branch), ahead/behind report as `null` rather than guessing
  against a branch that isn't actually checked out.
- **Refresh model:** manual only. Git status is computed once when a ready
  card first renders its panel, and again only when the user clicks
  Refresh/Fetch/Pull — no background polling. `useApplications`'s existing
  polling of `/api/applications` is unaffected and untouched.
- **Card scope:** only cards whose application is currently in the `ready`
  lifecycle state render a git panel, and only when the application has a
  resolvable repository (every current registry entry does, via the
  already-validated `repositoryRoot`).
- **Tooling:** shell out to the `git` CLI via Node's built-in
  `child_process.execFile` — matching SourceManager's proven pattern.
  HomeBase currently has zero git-related npm dependencies
  (`package.json`), and this plan does not add one.

## Goal and success criteria

- A `ready`-state application card shows its current branch, a clean/dirty
  indicator, and ahead/behind counts relative to its upstream (or an honest
  "no upstream" state).
- A user can manually refresh local status, run `git fetch`, or run a
  fast-forward-only `git pull` from the dashboard, per application.
- Pull is refused with a clear reason when the working tree is dirty; no
  destructive or history-rewriting git command is ever issued.
- No new build, dependency-install, or restart behavior is introduced — this
  stays informational-status-plus-safe-pull only, matching the user's
  explicit scope limit.
- The existing `/api/applications` endpoint, `ApplicationHost`, and hosted
  adapter contract are unmodified.

## Current implementation and boundaries

- `src/config/models.ts` / `src/services/ConfigService.ts`: each
  `ApplicationConfiguration` already carries a traversal-validated absolute
  `repositoryRoot` (resolved from the registry's `repoPath` via
  `resolveContained`, `ConfigService.ts` ~line 434-449). This plan reuses
  `repositoryRoot` directly as the `cwd` for git commands — no new path
  resolution or validation logic is needed.
- `src/routes/applications.ts`: existing pattern for a small Express router
  built from `configService` + a lookup service, returning
  `Cache-Control: no-store` JSON. The new router follows the same shape.
- `src/services/ApplicationHost.ts`'s `statusFor` already establishes a
  bounded-timeout pattern (2000ms) for potentially slow per-application
  calls, falling back to a safe state on timeout. The new
  `GitStatusService` follows the same spirit with its own timeouts, tuned
  for git's different cost profile (local commands vs. network fetch/pull).
- `dashboard/src/models.ts`, `useApplications.ts`, `httpDataSource.ts`,
  `App.tsx`: existing frontend data-loading pattern (`DashboardDataSource`
  interface, `AbortSignal`-aware fetch, `ApplicationCard`). The new panel
  plugs into `ApplicationCard` and adds new methods to
  `DashboardDataSource` rather than replacing the existing
  `listApplications` flow.
- Out of scope: build verification, dependency installation, restart, any
  destructive git operation (reset, checkout to a different branch/commit,
  force-push), authentication/credential management beyond what the host's
  git installation already provides, and any change to which applications
  are considered `ready` (git status is purely additive information on top
  of the existing lifecycle state).

## Architecture and decisions

### Backend: `src/services/GitStatusService.ts`

```ts
export type WorkingTreeState = "clean" | "dirty" | "unknown";

export interface GitStatusResult {
  branch: string | null;
  commit: string | null;
  workingTree: WorkingTreeState;
  upstream: string | null;   // e.g. "origin/main"; null if none configured
  ahead: number | null;
  behind: number | null;
  checkedAt: string;         // ISO-8601
  error?: GitStatusError;
}

export type GitStatusError =
  | "not-a-git-repository"
  | "no-upstream"
  | "detached-head"
  | "git-not-installed";

export type GitMutationError =
  | GitStatusError
  | "dirty-tree"
  | "non-fast-forward"
  | "network-error"
  | "timeout";
```

- `execFile("git", args, { cwd: repositoryRoot, windowsHide: true, timeout, maxBuffer })`,
  args always passed as an array — never string-concatenated into a shell
  command.
- Local status commands (`rev-parse HEAD`, `branch --show-current`,
  `status --porcelain`, `rev-parse --abbrev-ref --symbolic-full-name @{u}`,
  `rev-list --left-right --count HEAD...@{u}`) run under a short timeout
  (5s).
- `fetch`/`pull` run under a longer timeout (20s); a timeout or non-zero
  exit is translated into a structured `GitMutationError`, never raw
  stderr passed to the client.
- `pull` is implemented as `git pull --ff-only`. Before attempting it, the
  service re-runs `status --porcelain` (not a cached value) and refuses
  with `"dirty-tree"` if the tree isn't clean, closing the race between an
  earlier status read and the pull request.
- A per-application in-memory mutex (`Map<applicationId, boolean>`) rejects
  a second fetch/pull for the same application while one is in flight with
  a `409`, preventing overlapping git processes against the same
  repository.
- No credential handling: relies on the host's existing git credential
  helper / SSH agent, identical to SourceManager's approach.

### Backend: `src/routes/homebaseGit.ts`, mounted at `/api/homebase`

- `GET /api/homebase/applications/:id/git-status` — read-only; 404 if `:id`
  isn't a configured application (same lookup as `applications.ts`);
  otherwise returns `GitStatusResult`.
- `POST /api/homebase/applications/:id/git-status/fetch` — runs `git
  fetch`, recomputes, and returns `GitStatusResult`.
- `POST /api/homebase/applications/:id/git-status/pull` — runs the dirty
  check plus `git pull --ff-only`, recomputes, and returns
  `GitStatusResult & { pulled: boolean }`. Returns `409` with
  `error: "dirty-tree"` without attempting the pull when the tree isn't
  clean.

All three set `Cache-Control: no-store`. No new reserved top-level route
prefix is required: routes live under `/api`, already reserved, and
application-owned routes are mounted at `/<slug>/*`, never under `/api`.

### Frontend

- `dashboard/src/models.ts`: add a `GitStatus` type mirroring
  `GitStatusResult`/`GitMutationError`, and extend
  `DashboardDataSource` with `getGitStatus`, `fetchGit`, `pullGit` methods
  (all `(applicationId, signal?) => Promise<...>`).
- `dashboard/src/httpDataSource.ts`: implement the three new calls
  following the existing `AbortSignal`-aware fetch pattern already used for
  `listApplications`.
- New `GitStatusPanel` component, rendered inside `ApplicationCard` only
  when `application.state === "ready"`. It lazily loads status on first
  render (kept out of the `/api/applications` payload so that endpoint
  stays fast and unrelated to git), and shows branch, clean/dirty badge,
  ahead/behind (or "no upstream"), plus Refresh/Fetch/Pull buttons. Pull is
  disabled while dirty or when `behind` is `0`/`null`. Each button shows a
  busy/disabled state while its own request is in flight (mirroring the
  backend's per-application mutex — the UI never lets a user fire two git
  operations at once for the same card) and surfaces
  `GitStatusError`/`GitMutationError` values as short inline text.
- `useApplications.ts` and its polling interval are untouched; git status
  is intentionally outside that lifecycle.

## Implementation sequence

1. Add `src/services/GitStatusService.ts` with the status-computation
   function and the fetch/pull mutation functions, including the mutex and
   timeout handling described above.
2. Add `test/services/GitStatusService.test.ts`, exercising real temporary
   git repositories (not mocks) covering: clean repo, dirty repo, repo with
   an upstream ahead/behind by a known commit count, detached HEAD, and a
   non-git directory.
3. Add `src/routes/homebaseGit.ts` and mount it in `src/app.ts` alongside
   the existing `/api` router registration.
4. Add `test/routes/homebaseGit.test.ts` (integration, against a running
   Express app + fixture registry pointing at a temp repo): unknown-id
   404, clean-repo status, successful fetch, dirty-tree pull rejection
   (409), and overlapping-request rejection (409).
5. Extend `dashboard/src/models.ts` and `dashboard/src/httpDataSource.ts`
   with the git types and client calls; add/extend their existing tests
   (`httpDataSource.test.ts`) for the three new calls.
6. Add the `GitStatusPanel` component and wire it into `ApplicationCard` in
   `dashboard/src/App.tsx`, gated on `state === "ready"`; add component
   tests covering loading, clean/dirty display, ahead/behind display,
   fetch/pull success and failure, and disabled-pull states.
7. Update `docs/SPECIFICATION.md` with a short section documenting the new
   `/api/homebase/applications/:id/git-status(...)` endpoints: read-only
   vs. mutating, fast-forward-only pull, no build/install/restart.
8. Update `docs/TASKS.md`: insert a new Phase 7 (this feature), renumber
   the current Phase 7 "Deferred capabilities" to Phase 8, and trim Phase
   8's first two bullets so they cover only what remains deferred after
   this phase lands (see "Docs and task tracking" below for exact wording).
9. Live verification: point a real or scratch registry entry at a
   repository you control; verify clean vs. dirty badge, ahead/behind
   counts against a real upstream, a real `fetch` updating the behind
   count, a real fast-forward `pull` advancing the checked-out commit, the
   dirty-tree pull rejection, and the overlapping-request 409 — all against
   a live running HomeBase instance, not just automated tests.

## Test and acceptance plan

- `npm test`, `npm run typecheck`, `npm run build` all pass.
- `GitStatusService` unit tests pass against real temporary git repos in
  every state listed in step 2 above.
- `homebaseGit` route integration tests pass, covering 404, success, dirty
  rejection, and mutex rejection.
- Dashboard component tests pass for `GitStatusPanel`'s loading, success,
  and error states, and for the pull button's disabled conditions.
- Live verification (step 9) is performed and recorded before this phase is
  marked `Done` in `docs/TASKS.md`, consistent with this repository's
  practice of requiring runtime-verified evidence, not just passing tests,
  before a phase closes.

## Docs and task tracking

- `docs/SPECIFICATION.md` gains a section documenting the new endpoints and
  their read-only/mutating split.
- `docs/TASKS.md`:
  - New **Phase 7: Git status dashboard integration**, `Not started`,
    linking this plan, with checkboxes matching the implementation sequence
    above and an acceptance gate requiring both automated tests and the
    live verification pass.
  - The current Phase 7 ("Deferred capabilities") becomes **Phase 8**. Its
    first bullet, "Read-only Git checkout, upstream, build, and
    loaded-revision visibility," is trimmed to "Build and loaded-revision
    visibility" (status/branch/upstream visibility now lives in Phase 7).
    Its second bullet, "Git pull, dependency installation, build
    verification, restart, and rollback," is trimmed to "Dependency
    installation, build verification, restart, and rollback after a pull"
    (pull itself now lives in Phase 7).

## Deployment, rollback, and assumptions

- New files only: `src/services/GitStatusService.ts`,
  `src/routes/homebaseGit.ts`, their tests, `GitStatusPanel` and its test,
  plus additive changes to `dashboard/src/models.ts`,
  `dashboard/src/httpDataSource.ts`, and `dashboard/src/App.tsx`. No
  existing endpoint, contract, or schema changes.
- Rollback: remove the new files, revert the additive frontend changes, and
  unmount the `/api/homebase` router from `src/app.ts` — the existing
  `/api/applications` path and dashboard are unaffected throughout since
  nothing in this plan modifies them.
- Assumes `git` is installed and on `PATH` inside whatever process runs
  HomeBase (already true for local `npm run dev`; for the Docker path, the
  production/runtime image would need `git` added if this feature is ever
  needed there — out of scope for this plan, which targets the local
  development/dashboard use case implied by "the home page dashboard").
- Assumes the host's existing git credential configuration (SSH agent,
  stored HTTPS credentials) is sufficient for `fetch`/`pull` against each
  configured repository's remote, exactly as SourceManager assumes today.

  **(Resolved 2026-08-22, follow-up):** the Docker path turned out to be
  needed immediately. `git` is now installed in both the `dev` and `runtime`
  Dockerfile stages, and the `/workspace` bind mount was switched from `:ro`
  to `:rw` in both Compose files so `fetch`/`pull` can actually write into
  each repository's checkout from inside the container — see
  `docs/SPECIFICATION.md` §2 and §4.2a and the container/Tailnet deployment
  doc. This assumes every currently configured repository is public;
  anonymous HTTPS needs no credentials, so no SSH-agent forwarding or
  credential-store mount was added. A private repository would need that as
  separate follow-up work — untested and unsupported today.
