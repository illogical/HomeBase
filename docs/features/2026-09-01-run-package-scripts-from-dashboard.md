# Run package.json Scripts from the Dashboard

## Context

HomeBase's dashboard shows a card per tracked sibling project with live git status (`GitStatusPanel`). The next useful piece of context to surface is each project's `package.json` scripts, with the ability to trigger one directly instead of switching to a terminal — including long-running ones like `dev`/`start`, which need a way to see live output and stop them again. This plan adds that as a "flip" interaction on the existing project card: clicking the card's background flips it to reveal the project's available scripts, running one streams its output live to the flipped card back, and a Stop control kills it.

Confirmed while planning: HomeBase runs **inside the Linux dev container** (`docker-compose.dev.yml`, `build.target: dev`), with the sibling-project workspace bind-mounted read-write at `/workspace`. So any process this feature spawns is a Linux process — kill logic only needs the POSIX path (`SIGTERM` → `SIGKILL` on a process group), not Windows `taskkill`.

## Decisions

- Support both one-shot (build/lint/test) and long-running (dev/start/watch) scripts, with a Stop button for the latter.
- Output streams live via **socket.io** (already an installed-but-unused dependency on both server and client) — not polling, not buffer-then-return.
- Selecting a script on the flipped card back **replaces** the script list with a live scrollable output panel (same card face), with a way to navigate back to the list.
- No confirmation dialog — clicking a script runs it immediately, consistent with the existing no-confirm `git pull` action.

## Backend

### 1. `src/services/PackageScriptsService.ts` (new)

Modeled on `src/services/GitStatusService.ts`'s shape. Reads `<repositoryRoot>/package.json`, returns its `scripts` map.

```ts
interface PackageScriptsResult {
  scripts: Record<string, string>;
  checkedAt: string;
  error?: "no-package-json" | "invalid-package-json" | "read-error";
}
```

Plain `fs.readFile` + `JSON.parse` — no shell exec, no caching needed (read only happens lazily when a card is first flipped, not polled). `ENOENT` → `no-package-json`, `SyntaxError` → `invalid-package-json`, else `read-error`; always resolve with a typed result (never throw to the route), matching `GitStatusService`'s pattern of returning structured errors instead of 500s.

### 2. `src/services/ScriptRunnerService.ts` (new)

Owns process lifecycle. Uses `child_process.spawn` (not `execFile` — needs a live handle to stream output and kill), one concurrent run per application (`Map<applicationId, RunRecord>`), enforced the same way `GitStatusService`'s `#inFlight` lock works today.

```ts
interface RunRecord {
  runId: string;            // crypto.randomUUID()
  applicationId: string;
  scriptName: string;
  child: ChildProcess;
  outputBuffer: OutputChunk[];  // ring buffer, capped (e.g. 2000 lines) for replay on reconnect
  status: "running" | "exited" | "killed" | "error";
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}
```

- Command resolution by `application.packageManager` (npm/yarn/pnpm, default npm): `<pm> run <scriptName>`, `spawn(cmd, args, { cwd: repositoryRoot, detached: true })` — `detached: true` puts the child in its own process group so it (and anything it forks, e.g. a dev server) can be killed as a group.
- **Validate `scriptName` server-side against the live `package.json` scripts on every run request** (re-check via `PackageScriptsService`, don't trust a client-cached list) — closes the obvious "arbitrary command via crafted script name" hole.
- Stop: `process.kill(-child.pid, "SIGTERM")` (negative pid targets the whole process group), escalate to `SIGKILL` after a grace period (~5s) if still alive.
- A second run request for an app that's already running returns a conflict (409) carrying the existing `runId`, rather than queuing or running in parallel — matches the product's single "running/output" view per card, and is what actually motivates having a Stop button (to run something else, stop the current one first).
- Best-effort cleanup: register a process-exit handler on the service that kills all tracked children if HomeBase itself shuts down, so restarting the server doesn't routinely orphan dev servers.
- Losing run bookkeeping on server restart is accepted (documented, not solved) — in-memory only.

### 3. Socket.io wiring

- Instantiate once in `src/startServer.ts`, right after the HTTP server is created and before `applicationHost.attachRealtime(server)` (`src/startServer.ts:53-54`), using a **custom path** (`/homebase/socket.io`) so it can't collide with a future per-app adapter that also wants socket.io on the same raw server:
  ```ts
  const io = new SocketIOServer(server, { path: "/homebase/socket.io" });
  scriptRunnerService.attachNamespace(io.of("/homebase/scripts"));
  ```
- Room per `runId` (`run:<runId>`). Client joins after receiving a `runId` from the run/current-run REST calls. Server emits `output` events (`{ runId, stream, data, seq }`) and a terminal `status` event when the process exits. `seq` lets the client detect gaps after a reconnect and fall back to REST replay.
- Socket disconnect (tab closed, refresh, brief network blip) does **not** kill the running process — a `dev` server should survive a page refresh. The ring buffer keeps recent output so a reconnect can replay it.

### 4. REST endpoints — `src/routes/homebaseScripts.ts` (new), mounted in `src/app.ts` next to `createHomebaseGitRouter`

Same 404/409 conventions as `src/routes/homebaseGit.ts`.

- `GET /api/homebase/applications/:id/scripts` — list scripts (§1).
- `POST /api/homebase/applications/:id/scripts/:name/run` — starts a run, returns `{ runId, startedAt }`, or `409 { error: "operation-in-progress", runId }` if one's already active for this app.
- `POST /api/homebase/applications/:id/scripts/run/:runId/stop` — kills it; idempotent 200 if already terminal.
- `GET /api/homebase/applications/:id/scripts/run/current` — returns the active run for the app (or 404 none). Lets a re-flipped card or a freshly reloaded page discover and reattach to an in-progress run without having remembered its `runId`.
- `GET /api/homebase/applications/:id/scripts/run/:runId` — status + buffered output, for replay/gap-filling.

`ScriptRunnerService` needs to be a singleton shared between `app.ts` (routes) and `startServer.ts` (socket wiring) — have `createApp()` return `{ app, scriptRunnerService }` so `startServer.ts` can call `.attachNamespace()` on the same instance after construction.

## Frontend

### `dashboard/src/models.ts`

Add `ScriptsResult`, `RunState`, `OutputChunk` types and extend `DashboardDataSource` with `listScripts`, `runScript`, `stopScript`, `getCurrentRun`, `getRunReplay`, `subscribeToRunOutput` (the last wraps a lazily-created shared `socket.io-client` connection — created on first use, scoped per-room via `join-run`/`leave-run`).

### `dashboard/src/httpDataSource.ts`

Implement the new REST methods the same way `getGitStatus`/`fetchGit`/`pullGit` already exist; add the socket.io-client wrapper (new small helper, e.g. `dashboard/src/socketClient.ts`, kept separate from the REST transport).

### `dashboard/src/ScriptRunnerCardBack.tsx` (new)

Discriminated-union state machine mirroring `GitStatusPanel`'s pattern (`dashboard/src/GitStatusPanel.tsx:11-16`): `loading` → `list` → `running` (subscribed to socket, scrollable `<pre>` log, Stop button) → `exited` (exit code + tail of output, "Run again"/"Back to list"). On mount (first flip), calls `getCurrentRun` first — if one's active, jumps straight to `running` + replay via `getRunReplay`; otherwise calls `listScripts`.

### `dashboard/src/App.tsx` — `ApplicationCard` (lines 108-159)

- Wrap the card in a flip container (`.card-flip-container` / `.card-flip-inner` / `.card-front` / `.card-back`), toggled by a `isFlipped` state on click.
- Click handler on the card root checks `event.target.closest("a, button, input")` and bails out without flipping if truthy — covers the existing title link and all of `GitStatusPanel`'s buttons generically, no changes needed inside `GitStatusPanel.tsx`.
- Only offer the flip when `application.state === "ready"` (mirrors existing gating of `GitStatusPanel`).
- Mount `ScriptRunnerCardBack` lazily — only after the card has been flipped at least once — so unflipped cards issue zero extra requests.

### `dashboard/src/styles.css`

3D flip transform near the existing `.application-card`/`.card-git` rules (~lines 163-265): `perspective` on the container, `transform-style: preserve-3d` + `rotateY(180deg)` toggle on `.is-flipped`, `backface-visibility: hidden` on both faces. Give the back face a **fixed height with internal `overflow-y: auto`** for the log panel rather than growing the card (avoids reflowing the whole grid when one card flips). Respect `prefers-reduced-motion` consistent with any existing transition guards in the file.

## Config

- No new config field. Reuse the existing `enabled`/ready-state gate — every ready application can expose whatever scripts its `package.json` declares; that's the whole value of reading it directly instead of requiring curation.
- Leave the existing-but-unused `devCommands` config field alone (don't remove/migrate it — no reason to touch it for this feature); just don't build any new code path that reads it.

## Files

**Create:** `src/services/PackageScriptsService.ts`, `src/services/ScriptRunnerService.ts`, `src/routes/homebaseScripts.ts`, `dashboard/src/ScriptRunnerCardBack.tsx`, `dashboard/src/socketClient.ts`.

**Modify:** `src/app.ts` (wire new service + router, return `scriptRunnerService`), `src/startServer.ts` (instantiate socket.io, attach namespace), `dashboard/src/models.ts`, `dashboard/src/httpDataSource.ts`, `dashboard/src/App.tsx`, `dashboard/src/styles.css`.

No new npm dependencies — `socket.io`/`socket.io-client` are already installed.

## Verification

1. Pick a tracked sibling project with both a fast one-shot script (e.g. `lint`) and a long-running one (`dev`) — DevPlanner, LMApi, or MemoryApi per the dev-compose volumes.
2. Flip its card, confirm the listed scripts match its actual `package.json`.
3. Run the one-shot script, confirm output lines arrive incrementally (not all at once) — check dev-tools websocket frames.
4. Run `dev`, confirm the process is alive (`docker exec` into the container, `ps aux` / check the bound port), click Stop, confirm the whole process group actually exits and the port is freed (not just that the UI says "killed").
5. Flip away and back while a script runs — confirm it reattaches to live output via `GET .../run/current` + replay, not a blank/reset view.
6. Refresh the browser tab mid-run — confirm the same reattachment.
7. Attempt to start a second script while one is running (second browser tab) — confirm 409 with the existing `runId`.
8. Confirm clicking git-status buttons or the title link never triggers a flip.
