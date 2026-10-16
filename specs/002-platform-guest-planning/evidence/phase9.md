# Phase 9 implementation and verification — 2026-10-16

This supplements the 2026-10-15 baseline. It is not release approval and does not
convert unexecuted acceptance scenarios into passes.

## Delivered behavior

- OnHolidai branding and a static, code-native orthographic globe illustration with
  Lisbon/Rome/Istanbul route markers and marker-specific preference bubbles. It uses
  the existing local Natural Earth public-domain data, with visible attribution; no
  external image service, private session bootstrap or new image licence is involved.
- Direct country selection, green country highlighting, labelled major-city candidates,
  point/label hover emphasis and atomic country-to-city replacement. Sheet integration
  and its unused component were removed. Search/list remain independent of WebGL.
- Integrated Enter/icon searches with keyboard dropdowns, explicit manual/AI order,
  connected reorderable cards, reset and up to eight confirmed departure alternatives.
  Reset/unmount invalidate pending lookups. Departure alternatives describe one party,
  not separate traveller groups.
- Multi-range Day Picker calendar, editable collapsed date-window details, three-handle
  duration and five 1–10 preference sliders. Overlapping/adjacent windows stay separate;
  reverse selection is normalized and exact duplicates are ignored. IDs, timezones and
  preferred dates are retained. The preference mapping is `1 + stored * 0.09`, with a
  matching 0.09 keyboard step: all 101 legacy stored values round-trip unchanged.
- Immediate three-pane workspace, collapsed left editor/history, primary route globe,
  accepted stay/activity markers and mode-specific transport labels. Explicit `bus` is an
  additive segment mode; generic public transport is not mislabelled as a bus. Missing
  geometry and unverified connections remain disclosed.
- Shared pending editor state, clean-state refresh after acceptance and preservation of
  dirty fields across concurrent accepted changes. Settings still require impact review.
- Question-first chat, read-only answers/options, explicit proposal acceptance/rejection,
  durable outcomes after reload and exact undo. Research route options can be requested
  again against the latest accepted order policy and departure alternatives.
- Optional order/origin facts are compatible with old drafts/snapshots without injecting
  defaults into accepted history. Agent research compares comparable customer offers,
  explicitly proposes the chosen departure/default return and discloses unavailable
  comparisons, including an unavailable baseline origin. AI geographic ordering is a
  proposal, not a claim of verified transport feasibility.
- Exact requested signed-out notice, derived from the current server authentication
  session, not the trip's guest provenance.
- Registered Node loader hooks and explicit standalone worker application startup.

The frontend-design skill informed the restrained cartographic composition: existing
forest-green/sea-blue palette, a single prominent globe, connected journey cards and
quiet collapsible editing controls. No animation gates user input.

The calendar interaction follows the requested multi-range concept in the
[FlexiDatePicker reference](https://flexidatepicker.vercel.app/), implemented with the
already-installed React Day Picker rather than adding another runtime dependency.

## Executed checks

Environment: Windows, Node 24.22.0, the frozen pnpm 12.11.2 lockfile, Python 3.13/uv,
isolated PostGIS 18-3.6 databases and real deterministic agent/Temporal test services.
No live supplier booking/payment integration was enabled.

| Check | Result |
| --- | --- |
| Full web Vitest suite with all four `TEST_DATABASE_*_URL` roles | 317 passed, 68 files, no skips |
| Agent pytest | 83 passed |
| Agent ruff / strict pyright | passed; zero type errors/warnings |
| Web ESLint / TypeScript | passed |
| Agent export, generated Zod, snapshot/itinerary drift and source/promoted OpenAPI validation | passed |
| Next production build | passed |
| Focused redesigned Chromium journeys | 22 passed, no skips |
| Latest production HTTPS journeys, five browser profiles | 114 passed, one WebKit timeout, no skips/retries |
| Actual worker entrypoint subprocess against isolated DB + Temporal | passed (included in web suite) |

Commands use the package scripts' binaries directly when the local pnpm shim is
unavailable: `node node_modules/vitest/vitest.mjs run`,
`node node_modules/@playwright/test/cli.js test`, `node node_modules/typescript/bin/tsc`,
`node node_modules/eslint/bin/eslint.js` and `node node_modules/next/dist/bin/next build`.
Agent commands: `uv run --project agent {pytest,ruff,pyright}`.

The sandbox-only full-suite attempt passed 297 cases but failed seven Temporal cases
because SWC rejected the sandbox cache ACL. The same suite outside the sandbox passed
all cases; this was not fixed by changing application or dependency code. Restarted
local services were required after host/session interruption. A full Chromium baseline
run also recorded ten explicit pre-existing fixture-dependent skips; those are not
counted in the focused 22-case result.

The latest 115-case production HTTPS run started at 2026-10-16T14:44:32Z.
Chromium, Firefox, mobile Chromium and mobile WebKit each passed 23 cases;
desktop WebKit passed 22 and timed out in the ordinary-motion guest refinement
journey while reading the trip API response after a completed informational answer.
The report recorded 2,646,737 ms for a test configured for 120,000 ms, followed by
`Response has been disposed` during cleanup. The abnormal elapsed duration does not
establish a product root cause. This case remains unresolved, not passed; the
reduced-motion WebKit version completed. No timeout increase, retry, skipped
assertion or security relaxation was used to count it as passing. The verification
process sessions were no longer available after the environment interruption.

Reproduction selection: `booking-auth.spec.ts guest-planning.spec.ts guest-setup.spec.ts
planning-controls.spec.ts platform-ux.spec.ts homepage.spec.ts setup-accessibility.spec.ts`,
with `--workers 1 --reporter line,json`, `PLAYWRIGHT_BASE_URL=https://localhost:3443`
and the explicit local-certificate opt-in. The ignored local JSON report is
`web/test-results/phase9-verified-browsers.json`.

Reviewed synthetic screenshots: [mobile homepage](phase9-screenshots/home-mobile.png),
[desktop homepage](phase9-screenshots/home-desktop.png) and
[accepted workspace](phase9-screenshots/workspace.png). These illustrate appearance,
not manual assistive-technology acceptance or exhaustive state coverage.

### Longer-run defects reproduced and repaired

- Out-of-order guest renewals captured timestamps before taking the session lock. The
  older timestamp could acquire the lock last and violate the database's monotonic
  activity guard. `session-renewal.test.ts` reproduced the failure before the fix;
  monotonic `GREATEST` activity/expiry updates now pass it. Expired/revoked authority
  still cannot be renewed. No database guard was removed or bypassed.
- A read-only, 10,000-sample Python→Node diagnostic reproduced four strict `iat` failures
  at a wall-clock second boundary. Callback issuance now starts one second earlier;
  effective validity is shortened, not extended. All 10,000 follow-up samples passed,
  as did all existing strict future-token/scope/audience tests and a new callback
  boundary test. `scripts/measure-service-clock.py` reproduces the local measurement
  without API requests, database access or printed tokens.
- Server-rendered account POST buttons/controlled fields now remain disabled until
  hydrated, so an early click/fill cannot be silently discarded. The server-render
  regression is in `auth-hydration.test.tsx`.
- The same bounded issuance margin covers Node→agent dispatch/clarification transport;
  generic token factories and both strict verifiers are unchanged. Fixed rejection
  categories aid diagnosis without recording tokens, claim values or request bodies.
- New state regressions reproduce and prevent a late country lookup restoring a removed
  city, clearing a new chat draft when an earlier send finishes, and selected city hits
  falling through to the country underneath. Reset explicitly announces the cleared state.
- A redundant post-link refresh raced the next navigation in WebKit; linking now records
  its result without forcing another navigation. Booking-term links fetch current server
  eligibility. Domain and HTTP authorization guards remain unchanged.
- Daily-plan pace summaries and preference proposal rationales use the same 1–10 display
  as the sliders. Stored 0–100 values and accepted history are unchanged.

Development Turbopack reload churn interrupted repeated browser attempts, and the
webpack fallback could not bundle the installed instrumentation path. Final browser
verification uses the production build. WebKit correctly refuses production Secure
cookies over HTTP localhost: the HTTPS fixture uses a one-day certificate in a private
temporary directory and a loopback-only proxy (`scripts/local-https-proxy.mjs`).
`PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true` is an explicit test-certificate opt-in, defaulting
off; production cookie flags, origin checks and service-token verification stay strict.

## Continuation verification — 2026-10-16

- AI route ordering now evaluates the round trip from every confirmed departure
  alternative when geographic coordinates are available. Missing geography preserves
  the submitted order rather than implying an unsupported route. Manual refinement
  preserves the accepted stop order unless the traveller explicitly requests a reorder;
  newly proposed stops are appended for review.
- Confirmed-origin coordinates remain optional for legacy snapshots and drafts. Updated
  coverage exercises origin-aware route choice, missing-coordinate fallback, manual
  refinement/reorder policy, origin persistence, and legacy normalization.

| Check | Result |
| --- | --- |
| Full agent pytest suite | 88 passed |
| Agent Ruff | Passed |
| Pyright on changed agent modules and the new refinement test | Passed |
| Web focused Vitest: planning controls/options and guest-planning/booking-authorization integration | 23 passed, 7 database-dependent cases skipped |
| Web TypeScript and targeted ESLint | Passed |
| Source/promoted contract validation and snapshot contract drift | Passed |

The web database-dependent cases were skipped because isolated
`TEST_DATABASE_*_URL` configuration was unavailable; they are not counted as passes.
Repository-wide Pyright still reports three diagnostics in the unrelated,
unmodified `agent/src/onholidai_agent/integrations/nebius.py`; the changed agent modules
and new refinement test are clean. No database-backed matrix, human review, participant
cohort, or coordinated deployment gate is claimed complete by these local checks.

## Remaining acceptance/release work

- T087/T088: route-order and origin-selection implementation plus targeted state/agent/
  edit/undo tests exist, but the full frozen downstream order/origin matrix
  (finalization, changed-origin authorization and booking revalidation combinations)
  has not been exhausted. Database-dependent changed-origin authorization tests remain
  unexecuted in this environment.
- T098/T099: actual unrelated guest/account, expired credential, post-link old credential
  and ID-only HTTP denials plus fresh guest chat/history/undo journeys now run. Exhaustive
  valid-operation/stream/internal-service and interrupted/replayed recovery matrices
  remain open. The WebGL country-hit path has component coverage, not real globe-pixel
  automation.
- T100/T101: endpoint intent/link tests, actual free sign-up/link/sign-out/sign-in browser
  continuity, overlapping edit/link, old-grant denial and linked-principal booking tests
  run. Existing-email/failure/cancel/back combinations, controlled cross-replica quota/
  callback races and every account!=principal recovery/cancel/reschedule/worker branch
  remain incomplete. No booking consent is inferred from authentication/linking.
- T102: the local actual worker starts, but coordinated deployed web/agent/worker rollout
  and the non-destructive deployment-edge guest-entry withdrawal rehearsal were not run.
- T110: responsive controls, reduced motion, map failure and real workspace flows are
  covered. The entire redesigned asynchronous-state × viewport × zoom matrix is not
  exhausted.
- T111 and T113: manual assistive-technology review and the frozen >=20-person cohort
  have not been performed. Browser assertions are not substitutes.

See `us5.md` for actual input-acknowledgement samples. Timing is local deterministic
acknowledgement, not live research completion or participant satisfaction.
