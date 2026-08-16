# Phase 2 Static Frontend Prototype

**Status:** In progress

**Approved:** 2026-08-15

## Goal and success criteria

Build the first HomeBase dashboard as a static React and Vite prototype served
from HomeBase's existing Express listener. Establish the visual system,
responsive card layout, accessible interaction patterns, required application
states, and a replaceable data boundary without reading the Phase 1 registry or
claiming that live application status is connected.

Success means:

- `npm run dev` starts one HomeBase URL with Vite middleware and React HMR, and
  `http://localhost:<effective-port>/` displays the prototype;
- `npm run build && npm start` serves the production dashboard from the same
  Express listener at `/` and its hashed assets beneath `/assets`;
- loading, empty, ready, degraded, disabled, and unavailable presentations are
  manually viewable and covered by component tests;
- desktop, tablet, and mobile layouts are usable with keyboard navigation,
  visible focus, semantic markup, and WCAG 2.2 AA text contrast; and
- the production build, server integration tests, component tests, automated
  accessibility checks, and manual acceptance matrix pass.

## Current implementation and boundaries

- Phase 1 provides a Node 24 ESM project, strict TypeScript, Express 5, Vitest,
  one validated immutable `ConfigService`, and a startup sequence that validates
  configuration before calling `listen`.
- `createApp` currently creates an empty Express application, so `/` correctly
  returns `404`. There is no React, Vite, HTML, CSS, browser test environment, or
  static-serving behavior yet.
- Preserve `ConfigService` as the only environment/registry reader and preserve
  validation-before-listen. Phase 2 browser code must not receive configuration,
  repository paths, adapter paths, environment values, or real runtime status.
- Use static fixture data only. Phase 3 owns the read-only configuration/status
  API and replacement of this fixture source.
- Do not add health/readiness endpoints, hosted adapters, application route
  mounting, authentication, search, categories as navigation, favorites,
  recents, Git/version information, update controls, configuration editing,
  Docker, or Tailnet behavior.
- Do not add React Router, a CSS framework, Storybook, an icon library, or a
  second user-facing development port. This milestone has one page and can use
  semantic HTML, CSS, and small text monograms.
- Fixture routes are displayed as intended future destinations but are not
  clickable. Ready and degraded fixtures must not send users to known `404`
  routes; Phase 3 or the hosted-route work can enable launch links when route
  availability is truthful.

## Architecture and interfaces

### Dashboard toolchain and build separation

- Add `react` and `react-dom` as runtime dependencies. Add Vite, the official
  React plugin, React type packages, jsdom, React Testing Library, DOM Testing
  Library, `user-event`, `jest-dom`, and `axe-core` as development dependencies.
- Keep the server and browser builds explicit. The server TypeScript build must
  continue emitting `dist/main.js` without compiling browser modules; a client
  TypeScript configuration adds DOM libraries and `react-jsx`; Vite emits the
  dashboard to `dist/dashboard` with hashed files under `dist/dashboard/assets`.
- Add cross-platform clean, server-build, dashboard-build, combined-build, and
  dashboard-aware typecheck scripts. Implement cleaning with a small Node script
  using `fs.rm`, not a platform-specific shell command.
- Keep `npm test` as the one complete test entry point. Browser component files
  use Vitest's jsdom environment while Phase 1 server/configuration tests remain
  in Node.

### One-listener development and production hosting

- Refactor startup to create an explicit `http.Server` around the Express app
  before dashboard initialization, while retaining the injectable load/listen
  seams used by Phase 1 tests.
- Use a separate development entry point or an explicit startup mode so no class
  other than `ConfigService` reads environment variables. `npm run dev` selects
  development mode; compiled `npm start` selects production mode.
- In development, create Vite in middleware mode with `appType: "custom"`, bind
  HMR to the existing HomeBase `http.Server`, mount Vite's middleware, and serve
  only exact `GET /` by reading and passing the dashboard `index.html` through
  `transformIndexHtml`. This follows Vite's documented middleware-mode pattern
  while preventing an SPA fallback from swallowing `/api`, `/health`, `/ready`,
  or future application routes.
- In production, verify the built dashboard entry and asset directory before
  listening. Serve hashed files only beneath `/assets` and serve the built
  `index.html` only for exact `GET /`. Use `nosniff`, an explicit HTML content
  type, no-cache HTML, and long-lived immutable caching for hashed assets. Do not
  expose source files, source maps unless deliberately enabled for the build, or
  arbitrary files beneath `dist`.
- A missing/unreadable production dashboard or failed Vite initialization is a
  startup error before `listen`, because the dashboard is a required HomeBase
  route. Return a concise diagnostic without leaking filesystem details.
- Close the Vite development server when the parent HTTP server closes and in
  startup-failure cleanup. Do not add the full signal handling or graceful
  application shutdown policy reserved for later phases.

### Replaceable browser data seam

Define a browser-only view model rather than importing Phase 1 server models:

```ts
type ApplicationViewState =
  | "disabled"
  | "loading"
  | "initializing"
  | "ready"
  | "degraded"
  | "unavailable"
  | "stopping";

interface DashboardApplication {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly basePath: `/${string}/`;
  readonly state: ApplicationViewState;
  readonly statusSummary: string;
}

interface DashboardDataSource {
  listApplications(signal?: AbortSignal): Promise<readonly DashboardApplication[]>;
}
```

- The application root receives a `DashboardDataSource`; components and hooks do
  not import fixtures directly. Abort or ignore completion after unmount.
- Provide a fixture implementation with three prototype scenarios selected by
  the documented query parameter `fixture`: `mixed` (default), `loading`, and
  `empty`. Unknown values fall back to `mixed` without throwing.
- `mixed` contains four clearly labeled sample records using the intended
  DevPlanner, LMApi, MemoryApi, and LMEval names/routes, with one each in ready,
  degraded, disabled, and unavailable states. Status summaries explicitly use
  fixture language and must not imply observation of a real process.
- `loading` remains in the loading presentation until navigation or unmount;
  `empty` resolves to an empty frozen array. Do not add browser persistence,
  timers that survive unmount, random status changes, or requests to HomeBase.
- Display a persistent prototype notice stating that applications, statuses,
  and routes are sample data. Display route text for orientation, but render no
  application launch anchor or action in Phase 2.

## User experience specification

### Page structure and content

- Set the document language, title (`HomeBase`), viewport metadata, theme color,
  and a short description in `index.html`.
- Use a skip link followed by a semantic header and main region. The header has a
  restrained HomeBase wordmark/monogram and the label `Application portal`; the
  main content has one `h1`, a concise orientation sentence, the prototype-data
  notice, and the application collection.
- Render the collection as a semantic list. Each item contains an article with a
  two-letter decorative monogram, application name, description, text status
  badge, concise status summary, and intended route rendered as code-like text.
- Status badges always include state text and never communicate through color
  alone. Disabled and unavailable cards remain as visually complete and
  discoverable as ready/degraded cards.
- Loading uses stable card-shaped skeletons, `aria-busy`, and one polite live
  status message. Skeletons are hidden from assistive technology. Empty uses a
  calm heading and explanation without presenting an error or setup action.
- Include no dashboard navigation, search field, menu, settings, controls,
  charts, promotional copy, or fake operational totals.

### Visual system

- Use locally available system fonts only: a UI sans-serif stack for text and a
  system monospace stack for route labels. Do not fetch web fonts.
- Establish CSS custom properties with this baseline palette:
  - page `#111410`, surface `#191d18`, raised surface `#20251f`;
  - primary text `#f2f0e6`, muted text `#b5b8aa`, border `#394036`;
  - warm accent `#d7a95b`, stronger focus accent `#f0c878`;
  - ready `#7fc38b`, degraded `#e0b35f`, disabled `#9ba095`, unavailable
    `#d98578`.
- Use those status colors for small borders/indicators and text, not large filled
  regions. The specified text/status colors exceed 4.5:1 against the primary
  surface; recheck actual combinations after implementation.
- Use an 8px spacing basis, 12px card radius, restrained one-pixel borders, no
  gradients, no glass effects, and minimal shadow. Motion is limited to a subtle
  loading treatment and must stop under `prefers-reduced-motion`.
- Constrain content to approximately 1200px. Use one card column below 640px,
  two columns from 640px through 959px, and three columns at 960px and above.
  Cards within a row should align without forcing fixed heights or truncating
  user-visible descriptions.
- Preserve readable layout at 200% zoom and narrow widths without horizontal
  page scrolling. Long names, summaries, and route labels wrap safely.

### Accessibility behavior

- Meet WCAG 2.2 AA for the implemented page. Normal text must reach 4.5:1
  contrast; meaningful UI boundaries and authored focus indicators must reach
  3:1 against adjacent colors.
- Use native elements and heading/list landmarks before ARIA. Give live regions
  short non-repeating messages and avoid redundant labels.
- The skip link is the first focusable element, becomes clearly visible on
  focus, and moves focus/navigation to the main application content. Every
  interactive element must be reachable and escapable with normal keyboard
  commands; do not add positive `tabindex` values or focus traps.
- Provide a focus treatment at least two CSS pixels thick using the stronger
  accent, with offset so it is not obscured. Retain usable forced-colors behavior
  and never remove an outline without an equivalent.

## Implementation sequence

1. Add the React/Vite and test dependencies, split server/client TypeScript
   configuration, add the dashboard build output, and update npm scripts without
   weakening the Node 24 engine or Phase 1 gates.
2. Refactor the server startup boundary to own an explicit `http.Server`, then
   add development Vite middleware and exact-route production asset serving.
   Preserve configuration validation before any Vite initialization or listen.
3. Implement the browser view-model contract, abort-aware loading hook, fixture
   source, and query-selected scenarios. Keep the seam independent of server
   configuration and API wire assumptions.
4. Build the semantic shell, prototype notice, grid, cards, status badges,
   loading skeletons, and empty state. Apply the fixed visual tokens, responsive
   behavior, reduced-motion support, and visible focus styles.
5. Add server integration, component, state, keyboard, and automated
   accessibility tests. Perform the manual browser acceptance matrix in both
   development and production modes.
6. Update `README.md` only after the page exists: retain Phase 1 setup, state that
   `npm run dev` serves the dashboard at
   `http://localhost:<effective-port>/`, document how to determine the effective
   port, list the three `?fixture=` preview URLs, and document
   `npm run build && npm start` for production-mode viewing. Clearly label all
   scenarios as static Phase 2 fixtures.
7. Link this plan from Phase 2 in `docs/TASKS.md`, set the phase to `In progress`
   during implementation, check each item only after its evidence passes, and
   mark the phase `Done` only after the full acceptance gate. Update this plan to
   `Complete` with exact commands, results, screenshots/manual viewports, and
   remaining limitations.

## Test and acceptance plan

### Automated tests

- Preserve all Phase 1 tests, including immutable configuration, path security,
  validation-before-listen, and no-open-listener failure behavior.
- Test the data source contract: frozen deterministic order, each mixed status,
  empty resolution, permanent loading with abort/unmount safety, and unknown
  scenario fallback.
- Test the shell and cards by accessible role/name: one main heading, prototype
  notice, semantic list count/order, names, descriptions, status text, summaries,
  and displayed routes. Assert application cards contain no launch anchors or
  buttons.
- Test loading and empty semantics, including `aria-busy`, the live loading
  message, skeleton accessibility hiding, and the empty heading/message.
- Test the skip link target and keyboard focus behavior with `user-event`; avoid
  assertions against component internals or CSS class names.
- Run `axe-core` against mixed, loading, and empty rendered states and fail on
  any violations. Treat automated accessibility as partial evidence, not a
  substitute for keyboard/visual review.
- Test development-host setup with Vite creation injected or mocked: it mounts
  only after valid configuration, exact `/` uses transformed HTML, and cleanup
  closes Vite.
- Test production hosting from a temporary dashboard build: `/` returns HTML,
  `/assets/<fixture>` returns only the expected file and cache/content headers,
  missing output prevents listen, traversal cannot escape the asset root, and
  `/api`, `/health`, `/ready`, an unknown route, and an application-like route do
  not receive the dashboard HTML.
- Run a clean Node 24 `npm ci`, complete typecheck, production build, and full
  test suite. Confirm the package audit result and run `git diff --check`, JSON
  parsing, ignore checks, and Markdown-link validation.

### Manual browser matrix

- Development: start `npm run dev`, open `/`, verify React renders on the
  effective HomeBase port, edit a client component/CSS token, and confirm HMR
  updates without launching a second user-facing server or restarting Express.
- Production: run `npm run build && npm start`, open `/`, reload it directly,
  verify hashed assets load, and confirm browser console/network panels contain
  no errors or source-file exposure.
- View `?fixture=mixed`, `?fixture=loading`, and `?fixture=empty` at approximately
  375x812, 768x1024, and 1440x900. Check wrapping, card columns, spacing, no
  horizontal overflow, and no content overlap at 200% zoom.
- Navigate from the browser chrome using only the keyboard. Confirm the skip link
  appears, focus is visible and unobscured, reading/focus order follows the DOM,
  and no card misleadingly acts as a launch control.
- Verify the prototype notice and status text make the static nature of all data
  unmistakable. Confirm status meaning remains understandable in grayscale and
  forced-colors/high-contrast mode where available.

The Phase 2 acceptance gate passes only when every automated command succeeds
and the complete manual matrix is recorded. A build alone is not sufficient.

## Implementation record

Implemented on 2026-08-15:

- Added the split React/Vite dashboard build, fixture-only browser data source,
  semantic responsive UI, and development/production hosting on HomeBase's one
  HTTP server.
- Added development and production host integration coverage plus fixture,
  component, keyboard, unmount, and `axe-core` checks. The suite passes with 5
  test files and 76 tests.
- Under Node 24.19.0, `npm ci`, `npm run typecheck`, `npm test`, and
  `npm run build` pass; npm reports 0 known vulnerabilities.
- Static contrast calculation against the card surface measured 14.94:1 for
  primary text, 8.45:1 for muted text, and 6.16:1 or better for every approved
  status color; the focus accent measured 10.76:1.
- Live Node 24 production checks returned `200` for `/` and the hashed asset,
  with the required cache and `nosniff` headers. `/api`, `/devplanner/`, and an
  unhashed asset returned `404`.
- Live Node 24 development checks returned `200` for `/`, `/@vite/client`, and
  `/src/main.tsx` on the same port, while `/api` remained `404`.

Remaining before completion:

- A controllable browser was unavailable in the implementation session. The
  development HMR edit check and the complete viewport, 200% zoom,
  console/network, keyboard-from-browser-chrome, grayscale, and available
  forced-colors review remain unverified. The Phase 2 acceptance gate therefore
  remains unchecked and the phase remains `In progress`.
- Windows local npm/browser verification remains a non-gating follow-up. Docker
  and Tailnet packaging and verification remain deferred to Phase 6.

## Deployment, rollback, and assumptions

- This phase adds no data migration, API, registry change, external service, or
  deploy-time environment variable. Production remains `npm run build` followed
  by `npm start` on the configured HomeBase port.
- If dashboard initialization fails, startup fails before listen; do not serve a
  partial blank page or silently fall back to Phase 1's `404`.
- Rollback removes the dashboard packages/source/build integration and restores
  the Phase 1 empty Express app and scripts. The ignored `.env` and
  `config/homebase.json` remain untouched.
- The current `homebase.json` applications remain disabled and are not used to
  generate fixtures. Fixture states are illustrative, not operational truth.
- The default fixture scenario is `mixed`; Vite middleware shares the existing
  listener; application routes remain non-clickable; and the palette, content,
  breakpoints, and interface above are the approved defaults for implementation.
- README homepage instructions are deliberately deferred to the implementation
  step because the current Phase 1 root still returns `404`. Until Phase 2 is
  implemented and verified, the existing README remains the truthful startup
  documentation.
