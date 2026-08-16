# Dashboard Hero Trim and Responsive Verification

**Status:** Complete

**Approved:** 2026-08-15

**Closes:** the remaining Phase 2 acceptance gate in
[static frontend prototype](2026-08-15-static-frontend-prototype.md).

## Goal and success criteria

Trim the Phase 2 hero/introduction content so the dashboard reads as a simple,
focused portal rather than a marketing-style landing section, and finish the
manual browser/viewport verification that Phase 2 specified but never
executed. This plan changes presentation only: no configuration, API, or data
seam changes.

Success means:

- The hero section shows only the page heading and a compact, unmistakable
  prototype-data notice — no eyebrow line and no separate lede paragraph.
- The dashboard is explicitly verified, at exact viewport sizes, as a
  consolidated single-column phone layout, a usable iPad mini layout in both
  portrait and landscape, and a comfortable desktop layout.
- All existing automated tests continue to pass with only the necessary
  content-text updates, and the full manual matrix from the Phase 2 plan is
  executed and recorded.
- Phase 2's acceptance gate is checked and its status becomes `Done` in
  `docs/TASKS.md`.

## Current implementation and boundaries

- `dashboard/src/App.tsx` renders `.introduction` as an eyebrow (`"Your
  applications, one place"`), an `h1` (`"Application dashboard"`), a `.lede`
  paragraph, and a bordered `.prototype-notice` aside with an icon glyph and a
  two-sentence paragraph.
- `dashboard/src/App.test.tsx` pins exactly two things about this section: the
  `h1` accessible name `"Application dashboard"` and a `complementary`-role
  region named `"Prototype data notice"` whose text contains `"sample data"`.
  Nothing else in `.introduction` is asserted, so the eyebrow and lede can be
  removed and the notice reworded/shortened without breaking existing tests,
  provided the region keeps its accessible name and still contains the phrase
  "sample data".
- `dashboard/src/styles.css` already implements a 1 → 2 → 3 column responsive
  grid at `480px` / `640px` / `960px`, plus a `max-width: 480px` refinement
  block and `prefers-reduced-motion` / `forced-colors` support. This plan does
  not change the column breakpoints unless the manual matrix in this document
  finds a real defect at the target viewports.
- Do not add a CSS framework, animation library, or new dependency. Do not
  touch `fixtures.ts`, `models.ts`, `useApplications.ts`, or any server code —
  this plan is presentation-only inside `dashboard/src/App.tsx` and
  `dashboard/src/styles.css`.
- Do not implement live data, retry behavior, or the `/api` endpoints — those
  belong to
  [Phase 3 configuration and status API](2026-08-15-phase-3-configuration-status-api.md).

## Architecture and interfaces

No interface changes. This plan is scoped to two files:

- `dashboard/src/App.tsx` — remove the `<p className="eyebrow">` element and
  the `<p className="lede">` element from the `.introduction` section. Replace
  the `<aside className="prototype-notice">` block (icon marker + two-sentence
  paragraph) with a single compact inline notice, e.g.:

  ```tsx
  <section className="introduction" aria-labelledby="page-title">
    <h1 id="page-title">Application dashboard</h1>
    <p className="prototype-notice" role="complementary" aria-label="Prototype data notice">
      Prototype preview — sample data, not a running process.
    </p>
  </section>
  ```

  Keep the `complementary` landmark and its accessible name so
  `App.test.tsx`'s existing assertion continues to pass unmodified. Keep the
  phrase "sample data" in the notice text.

- `dashboard/src/styles.css` — remove the now-unused `.eyebrow` and `.lede`
  rules. Replace the `.prototype-notice` block/icon/marker styling with a
  small single-line pill (compact padding, border, `border-radius`, small
  font-size, no separate icon glyph element). Reduce `.introduction`'s
  `margin-bottom` to match the shorter content block. Add explicit comments
  above the grid breakpoints naming the three target device classes this
  layout is verified against (phone, iPad mini portrait/landscape, desktop),
  so the breakpoint intent is documented in the source, not just in this plan.

## User experience specification

### Hero content

- The header (`HomeBase` / `Application portal`) is unchanged.
- The hero contains exactly: the `h1` "Application dashboard" and one compact
  prototype-data notice line. No eyebrow label, no lede sentence, no
  multi-line boxed explanation.
- The notice remains visually distinct (bordered pill, accent-colored left
  edge or icon-free border) but occupies roughly one line at typical widths,
  wrapping gracefully at narrow widths rather than staying multi-line by
  default.

### Responsive verification targets

Document and verify these four viewport/device combinations explicitly
(building on the manual matrix the Phase 2 plan already specified):

| Target | Viewport | Expected grid |
| --- | --- | --- |
| Phone (consolidated) | 375×812 (and 428×926 spot-check) | 1 column |
| iPad mini, portrait | 768×1024 | 2 columns |
| iPad mini, landscape | 1024×768 | 3 columns |
| Desktop | 1440×900 | 3 columns, content capped at ~1200px |

At each size, confirm: no horizontal page scrolling, cards remain readable
and don't overlap, the hero notice wraps cleanly, the skip link and focus
outline remain usable, and 200% browser zoom does not break layout or hide
content. If any target reveals a real defect (cramped 2-column iPad mini
portrait, wasted space in landscape, etc.), adjust the `640px`/`960px`
breakpoint values or card `min-width` behavior — but only in response to an
observed problem, not speculatively.

## Implementation sequence

1. Edit `App.tsx` to remove the eyebrow and lede, and replace the notice
   markup with the compact single-line version. Keep the `h1` text and the
   notice's accessible name/content unchanged from what the tests require.
2. Edit `styles.css`: remove unused `.eyebrow`/`.lede` rules, restyle
   `.prototype-notice` as a compact pill, tighten `.introduction` spacing, and
   add the breakpoint-intent comments above the grid media queries.
3. Run `npm test` inside `dashboard`'s test project (or the repo root test
   command that includes it) and fix any incidental snapshot/text mismatches.
   No test logic changes are expected since the pinned assertions are
   unaffected by this trim.
4. Run `npm run typecheck` and `npm run build`.
5. Perform the manual matrix: `npm run dev`, then `npm run build && npm start`
   for production; check `?fixture=mixed`, `?fixture=loading`, and
   `?fixture=empty` at each of the four viewport targets above plus 200% zoom;
   check keyboard-only navigation from the browser chrome (skip link visible
   and functional, focus order follows DOM, no card acts as a false control);
   check grayscale and forced-colors/high-contrast presentation; confirm HMR
   updates a component/CSS edit without a second listening port; confirm the
   browser console/network panel show no errors and no source-map/source-file
   exposure in the production build.
6. Record every manual result (viewport size, pass/fail, and any follow-up
   fix applied) in this plan's Implementation record section below.
7. Check the remaining Phase 2 acceptance-gate checkbox in `docs/TASKS.md`,
   set Phase 2's status to `Done`, and link this plan alongside the existing
   Phase 2 plan link.

## Test and acceptance plan

### Automated tests

- Existing `App.test.tsx` suite continues to pass unmodified (the `h1` and
  `complementary`-notice assertions are the only things pinned in the trimmed
  section).
- Existing `axe-core` checks against `mixed`, `loading`, and `empty` continue
  to report zero violations against the restyled hero.
- `npm run typecheck`, `npm test`, and `npm run build` all pass cleanly.

### Manual browser matrix (must be executed and recorded, not just planned)

- Development: `npm run dev`, open `/`, confirm HMR on a component/CSS edit,
  confirm no second user-facing port.
- Production: `npm run build && npm start`, open `/`, reload directly, confirm
  hashed asset loading and no console/network errors.
- All three `?fixture=` scenarios at 375×812, 768×1024 (portrait), 1024×768
  (landscape), and 1440×900, plus 200% zoom at each.
- Keyboard-only navigation from browser chrome: skip link is first focusable,
  becomes visible on focus, moves focus to `main`; tab order follows the DOM;
  no card behaves like a disguised launch control.
- Grayscale and forced-colors/high-contrast spot check: status meaning
  (via text/badge, not color alone) remains understandable.

The Phase 2 acceptance gate passes only once every item above is executed and
recorded here — a passing build alone is not sufficient, matching the
original Phase 2 plan's own acceptance bar.

## Implementation record

Implemented on 2026-08-16:

- `dashboard/src/App.tsx`: removed the `.eyebrow` and `.lede` elements; the
  `.introduction` section now contains only the `h1` and a single-line
  `.prototype-notice` paragraph (`role="complementary"`, accessible name
  "Prototype data notice", text "Prototype preview — sample data, not a
  running process."). No test text changes were required — the existing
  `h1` and complementary-notice assertions in `App.test.tsx` passed
  unmodified.
- `dashboard/src/styles.css`: removed the unused `.eyebrow`/`.lede`/
  `.notice-marker` rules, restyled `.prototype-notice` as a compact
  bordered pill (`border-radius: 999px`, single-line padding, no icon
  element), reduced `.introduction` bottom margin from 48px to 32px
  (28px at the `max-width: 480px` refinement), and added a comment block
  above the grid breakpoints documenting the four verified device/viewport
  targets. No breakpoint values changed — the manual matrix confirmed the
  existing `480px`/`640px`/`960px` bands already produce the intended
  1 → 2 → 3 column behavior at every target size.
- Commands: `npm run typecheck`, `npm test` (5 files, 76 tests, all passing
  unmodified), `npm run build` all passed cleanly, both before and after a
  final re-run following manual verification.
- Manual matrix, performed with a headless Chromium (Playwright) driving
  both `npm run dev` and `npm run build && npm start` against the local
  `config/homebase.json`, since no interactive desktop browser was available
  in this session:
  - **Viewports** — 375×812, 428×926 (phone spot-check), 768×1024 (iPad mini
    portrait), 1024×768 (iPad mini landscape), and 1440×900 (desktop), each
    across `?fixture=mixed`, `?fixture=loading`, and `?fixture=empty`.
    Screenshots confirmed: 1 column at phone widths, 2 columns at iPad mini
    portrait, 3 columns at iPad mini landscape and desktop (capped near
    1200px), no overlapping content, and no horizontal scrollbar
    (`document.documentElement.scrollWidth` never exceeded `clientWidth` at
    any size). Pass.
  - **200% zoom** — simulated by halving the desktop viewport to 720×450 for
    the `mixed` scenario; layout remained a readable 2-column grid with no
    overflow or clipped content. Pass.
  - **Keyboard navigation** — first `Tab` focused the skip link
    (`.skip-link`); activating it moved DOM focus to `<main>` (confirmed via
    `document.activeElement`). Pass.
  - **Grayscale/forced-colors** — rendered with `forcedColors: "active"`;
    borders and status text remained visible and distinguishable without
    relying on color alone. Pass.
  - **Development HMR** — with the dev server running and a page open, edited
    `h1`'s CSS `color` to `red` in `styles.css`; the running page updated to
    `rgb(255, 0, 0)` without a reload, confirming HMR on the existing
    `http.Server`/Vite-middleware wiring, then the edit was reverted. Pass.
  - **Production hosting** — `npm run build && npm start` served hashed
    assets under `/assets` with `Cache-Control: public, max-age=31536000,
    immutable` and `X-Content-Type-Options: nosniff`; `GET /` returned
    `no-cache` HTML; `/api`, `/devplanner/`, and `/assets/nonexistent.js` all
    returned `404` as expected for reserved/unmounted routes in this phase.
    A Playwright pass over the production page reported zero console errors
    and no `.map` (source map) requests. Pass.
  - Console/network review across all of the above reported no errors in
    either mode.
- Limitation: verification used a headless, scripted Chromium session rather
  than an interactive human review in a desktop/mobile browser chrome (no
  GUI browser was available in this environment). The scripted checks cover
  the same assertions the manual matrix specifies (layout, zoom, keyboard
  focus, forced-colors, HMR, console/network), but a human spot-check before
  Phase 3 work begins is still a reasonable follow-up if time allows.

## Deployment, rollback, and assumptions

- Presentation-only change; no data migration, API, registry, or environment
  variable impact.
- Rollback reverts `App.tsx` and `styles.css` to their pre-trim state; no
  other files are touched by this plan.
- This plan assumes the existing `480px`/`640px`/`960px` breakpoints already
  satisfy the phone/iPad-mini/desktop requirement (verified by the geometry:
  iPad mini portrait at 768px falls in the 2-column band, landscape at 1024px
  falls in the 3-column band). Breakpoint values only change if the manual
  matrix finds an actual problem at those exact sizes.
