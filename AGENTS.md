# HomeBase Agent Instructions

These instructions apply to the entire HomeBase repository.

## Sources of truth

Before planning or implementing work, read:

1. [README.md](README.md) for project intent and current implementation status.
2. [docs/SPECIFICATION.md](docs/SPECIFICATION.md) for approved v1 architecture
   and contracts.
3. [docs/TASKS.md](docs/TASKS.md) for current progress and upcoming priorities.

`docs/TASKS.md` is also the persistent implementation checklist. Its checked and
unchecked items are the concise record of completed work and what remains.

Use [docs/BRAINSTORM.md](docs/BRAINSTORM.md) for possibilities and design context
only. It is not an implementation commitment and cannot override the
specification or an approved plan. Use [docs/BACKGROUND.md](docs/BACKGROUND.md)
as historical context and revalidate any external-repository claims before
relying on them.

The precedence order is: the user's current aligned instructions, this file, the
approved specification, the approved feature plan, and then brainstorm or
background material. If an approved plan conflicts with the specification, stop
and align on a specification update rather than choosing one silently.

## Required workflow

Use this workflow for each distinct project update:

1. Brainstorm the feature or change.
2. Inspect the current repository and align with the user on expectations,
   material tradeoffs, boundaries, and success criteria.
3. Write a decision-complete plan at
   `docs/plans/YYYY-MM-DD-<feature-slug>.md`.
4. Link the plan from the corresponding item in `docs/TASKS.md` and mark the
   status accurately.
5. In a separate, fresh session, implement the approved plan only when the user
   explicitly asks for implementation.
6. As implementation is verified, check off the corresponding tasks and
   acceptance gate in `docs/TASKS.md`.

Do not implement a project update when its plan is missing, ambiguous, or not
approved. Return to alignment and planning. Do not combine unrelated updates in
one plan merely because they affect the same repository. Every sibling project
reachable from HomeBase requires its own plan for that repository's update.

## Plan requirements

An implementation plan must give a fresh coding assistant enough information to
execute without making product decisions. Include:

- the goal, user-visible success criteria, and in/out-of-scope boundaries;
- current implementation facts confirmed from the affected repository;
- architecture decisions and affected interfaces, schemas, and data flow;
- lifecycle, degraded behavior, security, and other relevant failure modes;
- implementation steps grouped by subsystem or behavior;
- automated and manual tests with acceptance criteria;
- deployment, migration, monitoring, rollback, and documentation changes where
  applicable; and
- explicit assumptions plus anything deliberately deferred.

Plans begin as `Draft` while expectations remain open and become `Approved` only
after alignment. During implementation use `In progress`, `Blocked`, and
`Complete` accurately. A plan marked `Complete` must record what was actually
verified and any remaining limitations.

## Implementation discipline

- Read the approved plan again at the start of the fresh implementation session.
- Inspect the current worktree and preserve unrelated user changes.
- When another repository is in scope, read its own `AGENTS.md` and current
  documentation before editing it. Do not rely on stale paths or revisions from
  HomeBase planning documents.
- Keep changes within the approved scope. If implementation exposes a material
  missing decision or a conflict with `docs/SPECIFICATION.md`, stop and align
  instead of inventing behavior.
- Make established core-contract changes explicit in the aligned plan and update
  the specification in the same work.
- Validate in proportion to risk. Distinguish static checks from behavior verified
  on Docker, Windows, Tailnet, external services, or another machine.
- Update the linked plan and `docs/TASKS.md` as work progresses. Check a task with
  `- [x]` only when that exact task has been completed and verified; leave partial,
  failed, blocked, or unverified work unchecked and explain its state in the plan.
- Check a phase's acceptance-gate item only after the recorded validation proves
  it. Mark the phase `Done` only when every required task and its acceptance gate
  are checked. If later evidence invalidates completed work, reopen the affected
  checkbox and correct the phase status.
- Do not check off future tasks merely because supporting infrastructure exists,
  and do not treat a checked implementation task as proof that a separate
  acceptance gate passed.
- Mark plans `Complete` only when their acceptance criteria are met.
- Keep documentation honest about implemented, planned, deferred, and unverified
  behavior.
