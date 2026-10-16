# Phase 10 implementation and verification — 2026-10-16

The fifteen tasks for the latest homepage/setup/workspace request are implemented.
This is an implementation handoff, not completion of the feature's external release gates.

## Delivered behavior

- Homepage: exact Lisbon coffee-stop and Istanbul extra-night quotes, matching SVG
  description, multiline bubbles with measured text containment in all five browser profiles.
- Availability: start/end creation and right-click subtraction, with one click removing
  a day and the second endpoint subtracting the inclusive range from the pre-gesture
  windows. Interior subtraction splits windows; complete subtraction removes them.
  The visible Remove dates mode provides the same operation through keyboard/touch.
  Escape finishes a gesture. Reset clears every window and both pending endpoints.
- Overlapping ranges merge transitively, retaining an existing identity and preferred
  intent. Adjacent non-overlapping windows stay separate. Different-timezone overlaps
  produce a corrective error rather than silently reinterpreting dates. Editable legacy
  overlaps normalize in pending state; immutable accepted snapshots are unchanged.
- Five green shades cycle by window order; a sixth repeats the first. Calendar button
  labels identify the actual window independently of color. Rows show the dates and
  a Preferred/Flexible dropdown, with no per-window expandable date editor.
- Window and duration changes use one atomic parent update. The longest individual
  complete window sets the inclusive duration cap (at most 365); min/ideal/max remain
  ordered. Empty selection is incomplete: setup stores null duration values. The
  three-handle track highlights the selected min/max interval in dark green.
- Five style sliders use integer 1–10 stops. Fresh drafts store 44 for a displayed
  default of 5. Display rounding never rewrites untouched legacy 0–100 values; only
  an explicit slider edit maps back to storage. Summaries and agent rationales agree.
- Shared sage/forest card surfaces, clearer headings, compact city labels, and themed
  add/remove/review/proposal/history/finalization buttons apply to setup and workspace.
  Compact city labels retain an expanded transparent 44px hit area.
- Pricing: prominent customer total, formatted currency-specific taxes/fees, honest
  unknown amounts, estimated/expired/planning distinctions, current booking guard,
  and the unchanged exact signed-out account notice.
- Composer: sage textarea and coordinated focus styling with inline clearance for
  the complete outline inside the scrolling pane. Input/submission behavior is retained.

## Executed verification

Node 24.21.0 was extracted from the existing local installer into a temporary directory;
no runtime installation, dependency update or permanent PATH change was made. Commands
used the installed package binaries directly because pnpm/node were absent from PATH.

| Check | Actual result |
| --- | --- |
| Full web Vitest run before final legacy-normalization regression | 248 passed, 81 database-dependent cases skipped, 70 files |
| Final calendar/style/editor/propagation regression selection | 19 passed, no skips, including saved overlap/duration normalization |
| Web TypeScript and ESLint | Passed |
| Next.js optimized production build | Passed: compile, TypeScript and all 11 static pages |
| Full agent pytest | 88 passed |
| Agent Ruff and Pyright on changed agent modules | Passed |
| Snapshot contract drift and source/promoted OpenAPI validation | Passed |
| Homepage and planning controls across Chromium, Firefox, WebKit and both mobile profiles | 45 passed, no skips/retries |
| Final calendar sizing, normalization, subtraction/reset and integer preferences across all five profiles | 30 passed, no skips/retries |
| Actual Workspace rendered markup in Chromium, 320/390/768/1440 widths | No page overflow; focus outline contained at both edges |
| Same synthetic workspace, forced colors and 200% text enlargement/reduced motion | Visible focus retained; no page overflow |

The final 30-case pass follows the last CSS-specificity corrections and legacy-window
normalization. It supplements the earlier 45-case pass rather than counting 75 distinct
scenarios. The final focused Vitest selection follows the full run and includes the new
normalization regression; the full suite was not repeated merely to increase its count.

Relevant commands (from `web/`, with the temporary Node binary on PATH):

```text
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --max-warnings=0
node scripts/generate-snapshot-contract.mjs --check
node ../scripts/validate-contracts.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/planning-controls.spec.ts tests/e2e/homepage.spec.ts --workers 1 --reporter line
node node_modules/@playwright/test/cli.js test tests/e2e/planning-controls.spec.ts --grep "fixture-backed|calendar merges|six availability" --workers 1 --reporter line
uv run --project agent --offline pytest agent/tests
uv run --project agent --offline ruff check agent
uv run --project agent --offline pyright agent/src/onholidai_agent/context/build.py agent/src/onholidai_agent/graph/refine.py
```

Browser setup tests use the deterministic `mockSetup` API boundary. They verify real
rendered controls, input semantics and acknowledged fixture reload, not database durability.
Workspace geometry checks use `renderToStaticMarkup` of the actual Workspace with a
synthetic customer fixture, stylesheet links from the running app, and native browser
focus. This proves CSS/layout geometry, not a live authenticated trip or map initialization.
The artifact is produced with `WORKSPACE_VISUAL_HTML=true` in `workspace-render.test.tsx`.
200% text enlargement is not claimed as a complete manual browser-zoom/assistive-technology
journey. See the pending review below.

## Failures found and corrected

- Reset/reload initially raced an earlier save acknowledgement. The browser test now
  waits for the successful PATCH carrying the empty windows before reloading.
- Calendar dropdown captions appeared twice without Day Picker's base stylesheet.
  The stylesheet is now imported, with later scoped theme overrides.
- Broad legacy button selectors overrode compact city/day padding. Equally specific
  later selectors now win; the final matrix checks that the calendar itself fits at
  320px, in addition to checking page overflow.
- A saved oversized duration could survive independently of a calendar update. The
  shared component now reconciles bounds and normalized windows atomically in pending
  state, including on loading editable legacy values.
- Optional tax/fee fields were caught by TypeScript and now display To be confirmed.
- Regression expectations for the former fractional public scale were updated while
  retaining assertions that underlying legacy preference operations stay unchanged.
- The first five-profile attempt passed Chromium/mobile Chromium but Firefox/WebKit
  crashed before opening a page inside the sandbox. Outside the sandbox the engines ran.
- An initial outside-sandbox pass had a mobile WebKit automation timing sample of 1158ms.
  That measurement included scrolling/actionability and protocol round trips. The order
  toggle test now measures its browser click event through mutation and the next paint,
  retaining the <=1000ms requirement; no timeout increase, test retry or skipped assertion
  converts that earlier result to a pass. The final all-profile runs passed.

## Screenshots reviewed

- [Workspace desktop](phase10-workspace-1440.png)
- [Workspace at 320px](phase10-workspace-320.png)
- [Workspace at 390px](phase10-workspace-390.png)
- [Workspace at 768px](phase10-workspace-768.png)
- [Workspace with 200% text enlargement](phase10-workspace-text-zoom.png)

Homepage and calendar desktop/mobile screenshots from the browser runs were inspected
in `web/test-results/`; the production files remain the source of these visuals.

## Remaining gates

T119–T123 remain open: this environment has no isolated `TEST_DATABASE_*_URL`
configuration, no reachable configured PostgreSQL test environment and no Docker executable in its usual installed
location. The 81 skipped database cases are not passes. Full downstream origin/order,
valid HTTP operations/live streams, guest interrupted/replayed work, authentication
alternatives and controlled booking/link/quota/callback matrices require that environment.

T131 remains open for the full asynchronous-state × viewport × browser-zoom matrix and
the previously recorded Phase 9 live guest WebKit timeout. Passing fixture-backed
calendar tests does not resolve that separate live-trip investigation.

T132 remains open for actual manual screen-reader/keyboard/browser-zoom review.
T133 requires an authorized deployed web/agent/worker environment and non-destructive
disable rehearsal. T134 requires the frozen >=20-person cohort. No deployment, participant
results or manual assistive-technology pass is claimed.

No `.specify/extensions.yml` was registered, so pre/post implementation hooks are absent.
