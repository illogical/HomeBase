# Docker git credentials for private repositories

**Status:** Deferred — not approved for implementation. This document exists
so a future session has a concrete starting point; it still needs the open
decisions below resolved and turned into a decision-complete plan (per
`docs/TASKS.md`'s workflow) before any code changes.

## Context

The Phase 7 Git status dashboard feature
([plan](2026-08-22-git-status-dashboard-integration.md)) shells out to the
`git` CLI from inside the HomeBase container (`GitStatusService`, via
`node:child_process.execFile`) to report status and run `fetch`/`pull`
against each configured application's `repositoryRoot`. It relies entirely on
whatever git credential configuration is available to that process — no
credential handling of its own, matching the sibling SourceManager project's
approach.

Today this works only because every currently configured repository (in the
active registry) is public: anonymous HTTPS needs no credentials. Neither
`docker-compose.yml` nor `docker-compose.dev.yml` mounts an SSH agent socket,
an SSH key, or a git credential store into the container, and `git` inside
the image has no credential helper configured beyond Debian's defaults. If a
private repository is ever added to the registry, `fetch`/`pull` against it
will fail inside the container with a `network-error`/auth failure (see
`GitMutationError` in `src/services/GitStatusService.ts`) — HTTPS will prompt
for credentials non-interactively and fail closed; SSH will fail to find a
key or agent. This is not a HomeBase code bug — it's a container credential
gap.

The `/workspace` mount is already read-write (`docs/SPECIFICATION.md` §2),
so once credentials are wired up, no further mount-mode change should be
needed — this document is scoped to *authentication only*.

## Open decisions (resolve before writing an implementation plan)

1. **Which remote protocol will private repos actually use?** SSH (typical
   for `git@github.com:...` style remotes already configured on this host)
   vs. HTTPS with a stored token/PAT. The two need different plumbing (agent
   forwarding vs. a credential helper) — pick the one that matches how the
   real private remotes are actually configured today; don't build both
   speculatively.
2. **Per-repo or shared credentials?** Whether every private repo shares one
   set of credentials (one deploy key / one PAT) or each needs its own.
   Shared is simpler; per-repo is more isolated if repos belong to different
   accounts/orgs.
3. **Read-only vs. read-write credential scope.** `fetch` only needs read
   access to the remote; `pull` is `fetch` + a local merge, so it also only
   needs read access (HomeBase never pushes). A read-only deploy key or a
   read-only-scoped PAT is sufficient and meaningfully lower-risk than a
   general-purpose credential — prefer the narrowest scope the chosen
   provider supports.
4. **Where the secret material lives on the host**, consistent with this
   project's existing pattern of git-ignored, `.env.docker`-style local
   files (see `.env.docker.example`) rather than anything committed.

## Candidate approaches (pick one per decision 1, don't implement both)

### A. SSH agent forwarding (if private remotes use SSH)

- Mount the host's SSH agent socket into the container
  (`${SSH_AUTH_SOCK}:/ssh-agent` on Linux/macOS hosts) and set
  `ENV SSH_AUTH_SOCK=/ssh-agent` for the process. Windows/Docker Desktop
  hosts need `docker-desktop` npipe-to-socket forwarding or a small
  socat/plink shim — this is the fiddliest part on this host (the current
  dev environment is Windows) and should be spiked early to confirm it's
  viable before committing to this approach here.
- Add a new `.env.docker` variable (e.g. `HOMEBASE_HOST_SSH_AUTH_SOCK`)
  alongside the existing `HOMEBASE_HOST_*` variables, documented in
  `.env.docker.example` the same way.
- No image changes beyond ensuring `openssh-client` is installed (separate
  from `git`, which is already installed as of the Phase 7 Docker fix) so
  `ssh` is available as git's transport helper.
- Known hosts: the container needs `~/.ssh/known_hosts` populated for the
  remote's host (e.g. `github.com`) or `git` over SSH will fail on the
  first-connection host-key prompt inside a non-interactive process. Either
  bake known hosts into the image for a small fixed set of trusted git
  hosts, or mount a host-provided `known_hosts` file read-only.

### B. HTTPS with a stored credential (if private remotes use HTTPS/PAT)

- Mount a git credential file read-only into the container and point git at
  it via `credential.helper = store --file <path>` in a container-scoped
  git config (e.g. `/app/.gitconfig` or `GIT_CONFIG_GLOBAL` env var pointing
  at a mounted file, not the real user's `~/.gitconfig`).
- The credential file itself (`https://<token>@github.com`) is a secret:
  document it the same way `.env.docker` is documented (git-ignored,
  `*.example` template committed, real file supplied by the operator) —
  do not put the token directly in `.env.docker` as a plain env var if it
  would end up logged or exposed via `docker inspect`; a mounted file with
  restrictive permissions is preferable to an env var for this one.
- Simpler to set up on Windows hosts than SSH agent forwarding, at the cost
  of a long-lived token needing manual rotation.

## Explicitly out of scope for this future work

- Any change to `fetch`/`pull` semantics, the `dirty-tree` guard, or the
  fast-forward-only pull restriction already implemented in
  `GitStatusService.ts` — this is purely about making the *transport*
  authenticate, not changing what git commands run.
- Automatic credential rotation, multi-tenant credential isolation beyond
  what's noted in decision 2, or a UI for managing credentials — this stays
  an operator-configured, `.env.docker`-style file/mount, consistent with
  how the rest of HomeBase's Docker configuration works.
- Any change for the local (non-Docker) `npm run dev` path — it already
  works today via the host's own git credential configuration (SSH agent,
  stored HTTPS credentials), same as SourceManager assumes.

## Suggested next step

Once a private repository is actually about to be added to the registry:
confirm its remote protocol (decision 1) and credential scope (decision 3),
then write a proper decision-complete plan following this repo's normal
workflow (`docs/TASKS.md`'s "How to use this task index") covering the exact
Dockerfile/Compose diff, `.env.docker.example` additions, and a live
verification pass (a real `fetch`/`pull` against an actual private repo from
inside the container) before merging.
