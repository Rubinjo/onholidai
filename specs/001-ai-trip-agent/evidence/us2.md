# User Story 2 implementation evidence

Date: 2026-10-13. Status: implemented core behavior with the database and browser gates executed; manual accessibility, reconnect and participant evidence remain open.

## Delivered behavior

Reviewed direct edits and conversational refinements create immutable draft versions through the existing authoritative commit primitive. Stored impact fingerprints bind the exact base version, operations, candidate and customer-facing review. Stale/expired edits and protected booking state are rejected. Undo restores prior draft content as a new version. Replays use stored receipts rather than repeating mutations.

Refinement proposals are independently validated and repriced by web-owned read-only supply adapters. Route/date/party/style/constraint changes expose transport, stays, activities, availability, price and unresolved verification impacts before acceptance. Changed planning inputs clear superseded daily recommendations; full day-plan regeneration and verified feasibility remain US3 responsibilities. Missing essential offers fail closed.

The responsive workspace shares one TanStack Query TripEnvelope. Committed outbox events invalidate it; one-second polling preserves convergence when events are unavailable. Older reads cannot overwrite newer cached versions. External edits preserve unsaved inputs with an explicit conflict. Conversation/history reload, proposal acceptance/rejection, focused clarification and draft undo have dedicated UI controls. Booking remains unavailable.

The geographic map includes vendored Natural Earth country outlines, selected countries, ordered places and committed sourced segment geometry. The route list provides equivalent information and remains available on map failure. Dataset attribution/hash are in `web/public/maps/ATTRIBUTION.md`. MapLibre's worker bundle is vendored under `web/public/maplibre/` and addressed explicitly with `setWorkerUrl`, because the library otherwise derives a worker URL from the bundler chunk location where no worker file exists; its stylesheet is now imported so markers are positioned instead of flowing inline. See `web/public/maplibre/ATTRIBUTION.md`.

The workspace uses a viewport-bound three-column grid: the left (trip details, version history) and right (conversation) panels span both grid rows and run to the bottom of the page while scrolling independently, and the middle column owns the route, map, price and booking stacked top to bottom. The price bar is placed in that column by grid area while remaining last in the DOM, preserving the documented focus order. The middle panel neither scrolls nor clips: the map keeps its content size and absorbs spare height, and the route list is the only fallback scroll region (keyboard-focusable) so price and booking stay visible.

## Executed evidence

- Web regression suite: 153 passed, 0 skipped, on an isolated PostgreSQL 18/PostGIS 3.6 cluster provisioned for this run. Migration 007 was applied through the migration runner (`pnpm --dir web db:migrate`) and the previously skipped database-dependent suites executed instead of skipping. The foundation behaviour suite (`pnpm --dir web test:foundation`) passed 38 tests on the same cluster.
- Agent suite: 60 passed; Ruff passed. `uv run --project agent pyright --project agent` is **not** green: six pre-existing type errors remain in refinement code (`graph/refine.py` langgraph stubs and a partially unknown `tracing_context` at lines 29 and 40, `tools/retrieve_relevant_context.py` partially unknown argument at 21, `tests/contract/test_refinement_tools.py` attribute/return variance at 62, `tests/evaluation/test_refinement.py` attribute assignment at 36 and 55). They predate this session and were reproduced from both the repository root and the agent directory.
- Web TypeScript and ESLint passed. The Next.js production build succeeds with explicit runtime configuration (forcing `NODE_ENV=development` for the build fails, as it does for any Next.js build).
- Agent exporter, generated TypeScript/Zod, snapshot generation, promoted/source API references and corpus drift checks passed.
- Corpus 1.2.0, policy 1, seed `onholidai-evaluation-v1-seed-20261011`, hash `sha256:60972ec6d38367e27759150aed41dd27e26f43300153c87248d4483094e969a3`.
- Frozen refinement scoring: 100/100 exact predetermined operations, with 20 requests per specified group and zero unnecessary clarifications. Separate ambiguity scoring: 20/20 focused clarifications. The same 100 operations passed trusted web repricing and complete snapshot validation, preserving existing required constraints and integer customer totals.
- Synthetic context tests preserve structured evidence across 120 messages, bound recent history to 20 messages/8,000 conservative tokens, and recover uniquely referenced rejected destinations through scoped retrieval. Missing/multiple references ask one question.
- A rendered workspace regression measured all committed panes converging within two seconds under polling with events unavailable; subsequent older reads did not regress the cache. This is component-level evidence, not a full-stack latency measurement.
- US2 browser scenarios executed against a migrated deterministic stack (PostgreSQL/PostGIS, Next.js production server, FastAPI agent with `PROVIDER_MODE=deterministic` and no live providers) from a freshly seeded Tokyo/Kyoto accepted estimate for every run: 10 of 10 scenario runs passed, covering review/conflict/history/undo and clarification/rejection/map-failure/zoom/keyboard on chromium, firefox, webkit, mobile-chromium and mobile-webkit. The review scenario asserts that every pane reports one committed version within two seconds of acceptance on each engine; the clarification scenario asserts one focused question, rejection without mutation, an available route list when the map source fails, and reduced-motion, 200% zoom and Tab-order behaviour.
- Both scenarios must run one at a time from a fresh seed. They mutate one shared trip (`US2_TRIP_ID`), so the configured `fullyParallel` matrix interleaves them and the later scenario then correctly asks a feasibility question instead of proposing; each result above comes from its own seed.
- Three product defects were found and fixed while making those scenarios pass: refinement proposal events were recorded through the initial-estimate path (`recordEstimate`), so every refinement run failed with `estimate_unavailable` before a proposal could be reviewed; the Better Auth database configuration used an unsupported `casing` option together with `generateId: "uuid"` (which expects database-generated ids), so sign-up and sign-in failed with a schema mismatch; and `createDatabase` could not release a pool that had never served a query.
- The authored browser spec now retries the direct-edit review and the version-history undo until the application accepts them. WebKit discards values set before React hydrates a controlled field, and the history list reloads for the newly committed version, so fixed-timing interactions were unreliable on the slower engines. No assertion was relaxed; two supporting test fixtures were also corrected for migration 007.
- The fixture is now reproducible without ad-hoc scripts: `pnpm seed:us2-fixture` (`scripts/seed-us2-fixture.mjs`) creates or signs in the synthetic account, writes a Playwright storage state, creates the Tokyo/Kyoto draft, runs one `initial_estimate` request, accepts the proposal, and prints `US1_STORAGE_STATE` and `US2_TRIP_ID`. Verified end to end against the production build: the seeded fixture drove the review scenario to a pass, and the sign-in fallback works for an account that already exists.
- The map now renders: `Worker failed to load. Check that the worker URL is correct.` came from MapLibre deriving its worker URL from the bundler chunk location. Vendoring the worker and calling `setWorkerUrl` fixed it, and importing `maplibre-gl/dist/maplibre-gl.css` fixed the reported label overlap (`1. Tokyo`, `2. Kyoto` were `position: static` and flowed into the text below). Measured at 1600x1000, 1440x900, 1280x800, 1366x700 and 900x800: canvas present with a live WebGL context, markers `position: absolute`, no console errors, no horizontal overflow.
- Layout measured across the same viewports: no page scroll in the multi-column layout, the middle panel never scrolls and never clips, price and booking stay inside the middle column and fully visible, and the outer panels scroll independently while reaching the bottom of the page (verified at 1600x1000, 1440x900 and 1280x800: `details.bottom == conversation.bottom == workspace.bottom`, and the middle panel ends exactly where the price row begins). At 1440x900 the middle panel fits without any scrolling (route list 341 px of its own content, map 284 px). On viewports shorter than about 880 px the route list scrolls internally and keyboard users can scroll that region; the map, price and booking remain fully visible and nothing is clipped.
- Three further defects were found and fixed while verifying: the refinement conversation reserved each run against its cached version, so a competing commit made the next request fail with a conflict and left the previous proposal stale (the US1 path already re-read the current version); the trip-setup form sent `checkedAt: null` for a required timestamp, so every browser-created trip failed validation and the whole US1 setup journey was unreachable; and `estimate-outages.spec.ts` consumed an intercepted response body that the page can abandon mid-navigation. A fourth defect was found by the reviewer's manual pass: `Review edit impacts` sent an empty operation list when nothing had changed, which the review contract rejects, so the button answered with a generic failure instead of explaining that no settings had changed.
- `web/tests/unit/workspace-layout.test.ts` pins the layout contract (independent outer scrolling across both rows, middle-panel non-scrolling, map sizing floor, price in the middle column while last in the DOM, vendored worker URL); `web/tests/integration/trip-editor.test.tsx` pins the impact-review behaviour (an unchanged draft is explained locally and sends no request; only changed settings are reviewed).
- After these changes: web suite 159 passed, foundation 38 passed, US1/accessibility browser specs 4 passed, US2 refinement scenarios 10 of 10 across chromium, firefox, webkit, mobile-chromium and mobile-webkit.
- Two `next dev`-specific observations, both development-server artifacts rather than product defects: the seeded review scenario passes against the production build but its two-second staleness discovery budget is exceeded under `next dev`, so the recorded two-second results hold only for the production build; and a `next dev` server orphaned by a stopped parent process keeps serving stale code on port 3000. The relevant `.md` guidance and `pnpm dev` instructions list the production build for timing measurements.
- `infra/postgres/init/10-create-local-databases.sh` was checked out with CRLF on Windows (`core.autocrlf=true`), so the container's init step failed with `cannot execute: required file not found` and no roles, database or PostGIS existed — which is why authenticated journeys could not be started. A new `.gitattributes` pins LF for shell/SQL/Dockerfile files; recreating the volume now provisions roles, the `onholidai` database and PostGIS automatically, verified from a clean volume.

## Configuration and privacy

Nebius Token Factory connectivity was verified against the configured endpoint `https://api.tokenfactory.nebius.com/v1` with the configured API key: the authenticated model catalogue returned 25 models. The configured `NEBIUS_MODEL` value was invalid (`The model \`Nemotron-3.5-Lightning\` does not exist`); the catalogue exposes `nvidia/Nemotron-3_5-Lightning`, which answered a minimal chat completion with HTTP 200, and the local `.env` now carries that id. Agent planning remains deterministic by default; commercial provider access is not demonstrated by synthetic results.

EU LangSmith agent addressing was verified with the configured credentials against `https://eu.api.smith.langchain.com`: read access succeeds with the SDK's `x-api-key` header (a `Bearer` header is rejected, which the SDK does not use), and a run posted through the production `SafeLangSmithSink`/`AddressedTraceClient` path with `AgentAddress("onholidai", "local")` was ingested into the resolved agent-environment project `onholidai-local` with empty inputs and only the allowlisted `purpose`/`outcome`/`duration_ms` outputs plus the agent id/environment metadata. The workspace resolved the address to agent-environment projects, so addressing is enabled for this workspace. Automatic prompt/response/graph-state tracing remains disabled; synthetic sink tests still prove arbitrary purposes and outcomes cannot be exported.

## Human verification protocol

These steps need people; no result is recorded here until someone performs them. Fill each field only with what was actually observed, and include failures in the denominators.

### Run the application for manual review

```bash
docker compose -f infra/compose/compose.yml --profile infrastructure up -d postgres
pnpm --dir web db:migrate
uv run --project agent uvicorn onholidai_agent.api.main:app --host 127.0.0.1 --port 8000
pnpm --dir web build && pnpm --dir web start      # use the production build for timing checks
pnpm seed:us2-fixture                             # prints US1_STORAGE_STATE and US2_TRIP_ID
```

Open `http://localhost:3000/sign-in` and sign in with the synthetic account `synthetic-us2@example.invalid` and password `synthetic-us2-password-000000000` (there is no sign-up UI; `pnpm seed:us2-fixture` creates the account). Then open `/trips/<US2_TRIP_ID>`, which renders the workspace because the seeded estimate was accepted.

### T069 — manual keyboard and screen-reader completion (US2 checkpoint)

**Reviewer-reported manual pass (2026-10-14)**, on the production build in Firefox 157.0.1 (64-bit) on Windows 10, desktop PC. Recorded as T161.

| Journey | Result | Notes |
| --- | --- | --- |
| `Review edit impacts` with no changes | Failed, then fixed | Returned the generic failure `Unable to complete the request. Check your inputs and retry; your saved trip has not been silently changed.` The editor posted an empty operation list, which the review contract rejects (minimum one operation). It now explains `No settings have changed. Change a setting to review its impact.` and never sends the empty request. |
| Pace 60 → review → accept | Pass | Overview of changes rendered and acceptance applied them. |
| `Add two nights there` → clarification → `Kyoto, JP` | Pass | One focused question, resuming with the original intent and producing a reviewable overview. |
| Reject proposal | Pass | No other screen changed. |
| Undo latest draft, then reload | Pass | A new draft version was created and Pace returned to 50. |
| `Booking unavailable` throughout | Pass | Disabled with no warnings or colour-only signalling. |
| Windows Narrator review | Pass | The reviewer reported no issues with the clear text or the explanation of visual elements across the same journeys. |

The reviewer deferred the SC-006 cohort and the T138 recommendation-understanding measurements until the experience is more finished, so those remain open on T069/T138. The recorded coverage is the configuration above; broader engine and viewport coverage (Chromium, WebKit, 400 px widths) has not been verified by a human.

### T069/T138 — SC-006 recommendation understanding (fixed cohort)

Usability protocol v1: one fixed cohort of at least 20 leisure travellers, at least 5 using keyboard-only or screen-reader interaction and at least 5 each family-trip and multi-destination planners (groups may overlap). Identical task briefs, no assistance, failures counted in the denominator. SC-006 passes at 18/20 who correctly identify both the stated reason and the direction/amount/currency of the price impact.

Brief to read verbatim: "Accept a change you would consider taking. When the recommendation appears, tell me why it was suggested and what it does to the price."

| Participant | Interaction mode | Reason correct | Impact direction | Impact amount | Impact currency | SC-006 pass |
| --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |

Cohort size: ___ / 20 · Passes: ___ · Failures: ___ · Date and location: ___

### T068 — convergence and reconnect (mostly automated, human spot-check)

The measured part belongs in `web/tests/integration/version-propagation.test.ts`, which does not yet assert propagation: add the provider/map-failure, direct party/age and replay/reconnect cases there. The automated propagation cases, including an explicit SSE disconnect/reconnect assertion, are still missing.

Reviewer spot-check performed 2026-10-14 against the production build; all three steps behaved as described:

1. Open the trip in two windows and accept a change in one; confirm every pane in both reports one version, with a stopwatch showing under two seconds. — Reported working.
2. Block `**/maps/countries.geojson` in the browser, accept a change, and confirm the panes still converge and the route list remains usable. — Reported working.
3. Disconnect the network, accept nothing, reconnect, and confirm the workspace recovers to the same committed version with no duplicated or lost change. — Reported working.

## Open acceptance gates

- Provision the four isolated test database URLs and run SQL migration compatibility, scoped history/proposal APIs, concurrent edit/acceptance, receipt replay and undo tests. **Closed in this session**: the isolated cluster was provisioned, migration 007 was applied through the migration runner, and every database-dependent suite executed (153 web tests, 0 skipped; 38 foundation tests).
- Start the migrated deterministic application stack; provide `US1_STORAGE_STATE` and `US2_TRIP_ID` for a seeded Tokyo/Kyoto estimate with room for extra nights. Execute browser scenarios and inspect full-stack SSE reconnect and two-second convergence. **Closed for the two refinement scenarios**: the deterministic stack was started, the estimate was seeded through the public API, and 10 of 10 scenario runs passed with panes converging on one committed version within two seconds. The scenarios do not drive an explicit SSE disconnect/reconnect; convergence is asserted while events are unavailable/polling, and a deliberate reconnect assertion is still outstanding.
- Complete actual keyboard/screen-reader and zoom/reduced-motion/map-outage review. **Closed for the reviewer's configuration**: the reviewer completed the workspace, clarification, rejection, undo-with-reload and booking-disabled journeys by keyboard and then with Windows Narrator on 2026-10-14 (Firefox 157.0.1, Windows 10), reporting no issues with clear text or the explanation of visual elements; recorded as T161. Broader engine/viewport human coverage has not been performed.
- Run SC-006 with the required fixed 20-person cohort. No participant results were fabricated or inferred from automated tests.
- T128 remains partially open: refinement placeholders were repaired with documented reason and new frozen expectations, while US3 itinerary/hard-conflict placeholders are unchanged and are not scored as evidence.

The agent type check must be repaired before the agent job can be called green. The seeding entry point now exists (`pnpm seed:us2-fixture`), so the browser acceptance gate is reproducible; both scenarios still need a fresh `US2_TRIP_ID` per run and a production build for the two-second measurement.

T068 is partly satisfied (one committed version across panes within two seconds after acceptance on all five engines, and the reviewer confirmed the three human spot-check steps) but its provider/map-failure and direct party/age automated convergence cases are not asserted, so it stays open. T069 and T138 remain open only for the SC-006 participant cohort and the T138 recommendation-understanding measurements, which the reviewer deferred; their accessibility portions are discharged by T161. This file does not declare production acceptance.
