# Tasks: Supplier MCP Search and Whole-Trip Booking

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/supplier-discovery.md), [quickstart.md](quickstart.md).

**Prerequisites**: Existing repository inspection and design are complete. Preserve unrelated work. Implementation stays in the existing web, agent, shared contracts and booking worker boundaries. No new supply service, offer normalization system, trip store, authorization system, recommendation service or orchestrator.

**Tests**: Required by specification FR-031, the acceptance scenarios and constitution. Add meaningful behavioral/contract regressions before corresponding implementation and demonstrate the targeted regression fails; then implement and pass it. Do not treat skipped database/Temporal/browser tests or deterministic success as live-provider acceptance.

**Organization**: Setup, shared prerequisites, one independently verifiable phase per user story in specification priority order, then cross-cutting verification. Every checkbox represents work still to do, not a claim of implementation.

## Format: `[ID] [P?] [Story] Description`

- `[P]` identifies a task eligible for a named parallel wave after its predecessors finish; it does not remove dependencies or authorize spawning agents.
- Story labels map to spec US1–US5. Setup/foundation/polish have no story label.
- Paths are repository-relative, including proposed new files. Run filesystem operations from the repository using resolved absolute paths. Reuse existing files/components first; named new files are small focused extensions, not new service boundaries.
- Dependencies below are required. Unmarked tasks within a phase run in listed order unless the dependency section explicitly permits another order. Changes to shared schema/generated output/migrations are serialized. External activation/human gates are identified separately from code completion.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish reproducible validation and the one necessary dependency without rebuilding existing tooling.

- [ ] T001 Record baseline commands, existing failures/skips, current migration tip, environment prerequisites and preserved work in `specs/003-supplier-mcp-booking/evidence/baseline.md`; inspect `package.json`, `agent/pyproject.toml` and `web/server/db/migrations/` without printing secrets or starting live provider calls.
- [ ] T002 Add standalone FastMCP to `agent/pyproject.toml` and pin the resolved Python-3.13-compatible dependency set in `agent/uv.lock`; use in-memory transport and exclude optional cloud/task/LLM integrations, new processes and unrelated dependency upgrades.
- [ ] T003 [P] Create the per-provider/per-operation implementation and access evidence ledger in `specs/003-supplier-mcp-booking/evidence/provider-readiness.md` from `contracts/provider-readiness.md`; separately record implemented, deterministic, provider-test, live-access and externally blocked status with safe evidence references, explicitly leaving absent approvals/documents unverified.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared safe schemas, projections, tests and credential composition reused by every story. Complete T001–T008 before story implementation.

- [ ] T004 Extract only reusable component/service/price field definitions from `web/domain/trip/schema.ts` for use by `web/server/supply/offers.ts`; preserve the strict accepted-component parser and legacy snapshot decoder, and enforce the data-model rule “Money uses safe integer minor units and ISO currency.”
- [ ] T005 Tighten explicit customer/agent field allowlists in `web/domain/pricing/projections.ts`, safe errors in `web/server/errors.ts` and existing telemetry filters in `web/server/telemetry.ts` and `agent/src/onholidai_agent/telemetry/redaction.py`; nested supplier strings/URLs/errors cannot carry economics, credentials, payment or sensitive traveller data into outputs/logs.
- [ ] T006 Extend existing exporters/checkers in `web/scripts/generate-snapshot-contract.mjs`, `agent/scripts/export_contracts.py` and `scripts/validate-contracts.mjs` for canonical public supply and tool wire contracts; retain Zod/Pydantic ownership and cross-language fixtures rather than hand-maintained MCP offer copies.
- [ ] T007 Extend deterministic provider and clock/fault fixtures in `web/tests/fixtures/providers.ts`, `web/tests/helpers/booking.ts` and `agent/tests/fixtures/doubles.py` for explicit search/detail/revalidation modes, write counters, evidence, partial outcomes and crash/replay; use synthetic data only and no production-controlled fault switches.
- [ ] T008 Extend typed configuration/injection in `web/server/config.ts`, `web/server/application.ts` and `.env.example` to replace the generic travel-key assumption with provider/operation readiness and separate read/transaction secret references; fail closed per operation without disabling unrelated providers or accepted-trip reads, and expose no supplier credentials to Python/browser.

**Checkpoint**: Existing trip/proposal/authorization ownership is unchanged, shared contracts can express safe uncertainty, deterministic fixtures support observable outcomes, and no new infrastructure is needed.

## Phase 3: User Story 1 — Find and compare relevant offers (Priority: P1, MVP)

**Goal**: Research four supplier categories from the workspace, inspect details/revalidation, and compare truthful source facts separately from accepted components.

**Independent Test**: With deterministic providers, search a seeded trip, compare offers including hotel/apartment/another property type, inspect details and revalidate. Verify accurate source/freshness/unknown facts and partial failures, with zero reservations/provider transactions and no accepted-trip version change.

### Tests for User Story 1

- [ ] T009 [P] [US1] Extend `web/tests/contract/supply-read.test.ts` and add `web/tests/contract/provider-readiness.test.ts` for the discovery/readiness contracts: all source outcome categories, unknown dates/costs/terms, property types, exact provider attribution, bounded reads, failed prerequisites, nested privacy canaries and zero transactional effects.
- [ ] T010 [P] [US1] Add actual FastMCP list/call contract tests in `agent/tests/contract/test_supplier_mcp.py` for exactly four read tools, strict typed args/results, concurrent owner/run isolation, rejected forged context, revoked/stale grants and forbidden transaction tools; do not substitute direct-handler-only tests.
- [ ] T011 [P] [US1] Add `web/tests/integration/offer-research.test.tsx` and `web/tests/integration/supplier-research-access.test.ts` for search/comparison/detail/revalidation, browser ownership versus active agent grants, no-match/outage distinction, stale/out-of-order responses and unchanged accepted state.

### Implementation for User Story 1

- [ ] T012 [US1] Evolve `web/server/supply/offers.ts` and `contracts/supply/offers-v1.schema.json` in place with record/revision/query-product-party identity and source evidence; preserve “estimated | quoted | live_revalidated | expired” separately from “available | unavailable | unknown”, keep missing discovery dates/details/customer price/tax/fee facts nullable, and require strict complete-component materialization rather than fabricated defaults.
- [ ] T013 [US1] Extend existing capabilities and read methods in `web/server/supply/read.ts`, `web/server/supply/providers/adapter.ts` and `web/server/supply/transactions.ts`: canonical IDs “booking”, “duffel”, “trainline”, “getyourguide”; support “supported | unsupported | unknown”; access “unconfigured | configured_unverified | verified | blocked”; preserve `booking.com` attribution as an alias, declare property/query/coverage/rate/deadline/freshness limitations, and keep unknown limits unknown.
- [ ] T014 [US1] Append `web/server/db/migrations/014_supplier_research.sql` and update `web/server/db/types.ts` for offer references/revisions/evidence and read-only `supplier_research` runs, using existing records/grants; retain original query evidence and enforce “Legacy missing evidence is unknown and cannot be promoted to live” without editing migrations 001–013 or widening proposal purposes to allow research mutations.
- [ ] T015 [US1] Extend run/tool wire models in `agent/src/onholidai_agent/models/api.py`, `agent/src/onholidai_agent/models/tools.py`, `agent/src/onholidai_agent/models/contracts.py` and `web/server/agent-client/run-repository.ts` for read-only research and safe references; use existing grants/scopes, reject owner/trip/version/token overrides, and keep mutation proposals impossible for this purpose.
- [ ] T016 [US1] Extend `web/server/supply/providers/synthetic.ts` and `web/server/supply/providers/adapter.ts` with deterministic search/detail/live-revalidation evidence and property variants; remove query-noon service-time substitution and per-search random adult IDs, derive stable anonymous party slots, evaluate service-date age only from trusted evidence, and represent unavailable facts as unknown.
- [ ] T017 [P] [US1] Implement Booking.com Demand search/details/availability transport mappings in `web/server/supply/providers/booking-read.ts` and focused client `web/server/supply/providers/booking-http.ts` using approved documented wire fixtures; preserve property/product/room/occupancy and mandatory price/terms facts, bounded abortable calls and separate order-access prerequisites, with no reserve/order methods.
- [ ] T018 [P] [US1] Implement Duffel search/current-offer/detail/pricing read mappings in `web/server/supply/providers/duffel-read.ts` and focused client `web/server/supply/providers/duffel-http.ts`; preserve fares, baggage, service/payment-fee prerequisites, expiry and changed prices with approved fixtures, and exclude holds/orders/payment writes.
- [ ] T019 [P] [US1] Implement GetYourGuide reseller Partner API tour/option/detail/availability/pricing read mappings in `web/server/supply/providers/getyourguide-read.ts` and focused client `web/server/supply/providers/getyourguide-http.ts` using approved fixtures; exclude the inbound Supplier API and cart/reservation/booking methods and declare access/coverage limitations.
- [ ] T020 [P] [US1] Extend `web/server/supply/providers/trainline-read.ts` with deterministic rail detail/revalidation and explicit blocked live capabilities until approved partner wire contracts establish methods/auth/limits/semantics; implement supplied approved mappings if available and record any absent external prerequisite in `specs/003-supplier-mcp-booking/evidence/trainline-access.md`, never guessing endpoints or faking live success.
- [ ] T021 [US1] Consolidate search/detail/revalidation persistence and projection in small functions in `web/server/supply/planning-research.ts`, reusing `read.ts` and `offers.ts`; enforce four-provider/32-offer bounds, fair requirement groups, <=8s supplier and <=12s overall budgets, abort propagation, at most one deadline-fitting rate-directed read retry, safe source-specific outcomes and revision compare-and-swap.
- [ ] T022 [US1] Retain/refactor `web/app/api/v1/internal/trips/[tripId]/planning-search/route.ts` and add sibling `planning-offers/[offerRef]/route.ts`, `planning-offers/[offerRef]/revalidations/route.ts` and `planning-capabilities/route.ts`; reuse internalActor/run grants/current-version/context validation, same web audience/trip:read scope and canonical supply functions, denying native-ID/arbitrary-URL access and ungranted cross-run references.
- [ ] T023 [US1] Add browser sibling routes `web/app/api/v1/trips/[tripId]/planning-offers/[offerRef]/route.ts`, `planning-offers/[offerRef]/revalidations/route.ts` and `planning-capabilities/route.ts`; use current resource/session/Origin guards and existing run creation/result reads for search, distinguish owner access to completed research from active agent grants, and return only safe current-trip evidence.
- [ ] T024 [US1] Implement per-run in-memory facade in `agent/src/onholidai_agent/integrations/supplier_mcp.py` and extend `agent/src/onholidai_agent/api/store.py`; register only supplier_search/supplier_offer_details/supplier_revalidate_offer/supplier_capabilities, capture immutable trusted request/store outside schemas, and enforce closed arguments including nonempty unique componentTypes max 4, destination UUIDs max 8, ordered ISO dates and positive offer revisions.
- [ ] T025 [US1] Wire actual MCP calls into `agent/src/onholidai_agent/integrations/runtime.py`, `agent/src/onholidai_agent/graph/router.py` and `agent/src/onholidai_agent/graph/refine.py` for research-purpose dispatch/resume; retain existing Tavily Search API/maps advisory facts, bounded context and separate supplier evidence without introducing Python supplier clients or transaction credentials.
- [ ] T026 [US1] Compose deterministic and approved real read clients in `web/server/supply/providers/index.ts` and `web/server/application.ts`; empty/blocked live registries produce explicit provider outcomes/readiness, not synthetic fallback, and actual configured access is not marked verified solely from a factory name or key.
- [ ] T027 [US1] Add `web/components/trip-workspace/offer-research.tsx` using current UI/ComponentDetails patterns and mount it in `web/components/trip-workspace/workspace.tsx`; show comparable requirement groups, provider/property labels, nullable customer facts, estimated/quoted/live/expired labels, detail/revalidation and safe retries separately from accepted components while retaining the three-pane layout.
- [ ] T028 [US1] Extend existing query/event handling in `web/components/trip-workspace/use-trip.ts`, `web/components/trip-workspace/use-trip-events.ts` and `web/components/trip-workspace/offer-research.tsx` for trip/version/revision-keyed research, aborted/late response rejection and stale labels; supplier failure must preserve accepted trip and unsaved editor state.
- [ ] T029 [US1] Enforce research-only result/persistence and bounded safe reference reads in `web/server/agent-client/run-repository.ts`, `web/server/agent-client/results.ts` and `web/app/api/v1/agent-runs/[runId]/route.ts`; a read-only run cannot submit proposal operations, mutate a trip or convert research revalidation into booking authority.
- [ ] T030 [US1] Regenerate/check canonical supply, snapshot and agent artifacts through `agent/scripts/export_contracts.py`, `web/scripts/generate-agent-contracts.ts`, `web/scripts/generate-snapshot-contract.mjs` and `scripts/validate-contracts.mjs`; update compatible fixtures in `contracts/agent-api/` and `contracts/supply/` and prove Python/web output agreement without a second normalization algorithm.
- [ ] T031 [US1] Complete the four-provider workspace journey in `web/tests/e2e/supplier-search.spec.ts`, exercising unknown facts, empty/partial sources, detail/revalidation, stale versions and private access with zero provider writes; run T009–T011 regressions after implementation and preserve real MCP protocol assertions.
- [ ] T032 [US1] Run the US1 quickstart commands and controlled-clock search measurements, recording non-skipped results and SC-001 p95 <=10s/all <=12s plus zero trip mutations/transactions in `specs/003-supplier-mcp-booking/evidence/discovery.md`; retain unverified live access and unrun participant outcomes as separate gates.

**Checkpoint / MVP**: Four-source deterministic discovery, comparison, details and read-only revalidation work from the current workspace; live operations are independently gated. This is useful without recommendations or booking. Accessibility basics apply here even though cross-journey certification is in US5.

## Phase 4: User Story 2 — Receive decisions that respect stated preferences (Priority: P1)

**Goal**: Make routine suitable selections and explain material trade-offs without unnecessary questions; preserve existing accepted-trip rules.

**Independent Test**: Use at least 20 fixed cases spanning four categories, dominant/equivalent offers, unresolved meaningful competition and material missing facts. Verify 100% appropriate decision/question behavior with no favourable unknown claims, using the current proposal policy independently of booking.

### Tests for User Story 2

- [ ] T033 [P] [US2] Extend `agent/tests/evaluation/test_estimates.py`, `agent/tests/evaluation/test_refinement.py` and fixed cases in `agent/tests/fixtures/evaluation-corpus.json` for all preferences/constraints/budget/dates/party/commitments, dominant/equivalent/competitive options and material missing facts; require SC-003 outcomes rather than spend-percentile mirroring.
- [ ] T034 [P] [US2] Extend `web/tests/integration/trip-planning.test.ts` and `web/tests/contract/refinement-api.test.ts` for selected-reference grants, materialization/repricing, automatic versus manual policies, price/schedule impact, summaries/undo and stale proposal rejection with zero transactional effects.

### Implementation for User Story 2

- [ ] T035 [US2] Extend `agent/src/onholidai_agent/graph/estimate.py::select_quotes` to filter proven hard failures, keep required unknown evidence unresolved and compare viable options using current preferences, constraints including stated budget, service dates, party and commitments; do not equate spend preference with an invented monetary budget or add a recommendation service.
- [ ] T036 [US2] Implement material-question/dominance/equivalence handling in `agent/src/onholidai_agent/graph/estimate.py` and `agent/src/onholidai_agent/graph/refine.py`; use the documented tie-break provider ID then provider offer ID only for equivalent normalized terms, explain material assumptions/trade-offs, and ask through existing typed chat clarification only when the answer changes fit/eligibility or resolves genuine competition.
- [ ] T037 [US2] Extend structured refinement requests/grants in `agent/src/onholidai_agent/models/api.py`, `web/server/agent-client/run-repository.ts` and `web/domain/trip/proposal.ts` to import opaque selected offerRef/revision from prior same-owner/trip/current-version research after server validation; native IDs and unrelated prior runs cannot authorize access or acceptance; regenerate/check affected `contracts/agent-api/` artifacts through `agent/scripts/export_contracts.py` and `web/scripts/generate-agent-contracts.ts` before the US2 checkpoint.
- [ ] T038 [US2] Reuse trusted candidate recomputation in `web/domain/trip/refinement.ts`, `web/domain/trip/accept-proposal.ts` and `web/domain/trip/commit.ts` to materialize only complete current offers, validate source facts/constraints/reprice and preserve manual/automatic application policy, change summaries, inverse/history and stale-version handling; selection itself is not trip acceptance or booking authorization.
- [ ] T039 [US2] Reuse the decision policy across `agent/src/onholidai_agent/graph/refine.py`, `agent/src/onholidai_agent/graph/finalize.py` and `agent/src/onholidai_agent/context/build.py`; keep short rationale/assumptions and bounded advisory facts, remove unnecessary forced-choice prompts and inaccurate booking-unavailable wording, and direct consequential requests to exact review without interpreting chat as consent.
- [ ] T040 [US2] Integrate recommendation/selection and focused chat questions in `web/components/trip-workspace/offer-research.tsx` and `web/components/agent/conversation.tsx` using the existing run/clarification/proposal flow, immutable application policy and actual-change summaries; do not add equivalent-option approval dialogs or a second accepted-offer store.
- [ ] T041 [US2] Run T033–T034 and the current context/proposal regressions, recording all >=20 decision cases, zero unnecessary questions for dominant/equivalent cases and 100% material-question behavior in `specs/003-supplier-mcp-booking/evidence/recommendations.md`; retain booking and participant validation as separate gates.

**Checkpoint**: Recommendations and normal planning selection work with fixed or live-ready research evidence without booking. Research results remain distinct from accepted components and no proposal bypass exists.

## Phase 5: User Story 3 — Review and authorize one complete trip (Priority: P1)

**Goal**: Complete the existing booking page and exact trip-wide consent, blocking incomplete/ineligible trips on both client and server.

**Independent Test**: Seed a complete trip with deterministic current evidence, review all terms and create/replay one exact whole-trip authorization/start record. Remove a leg/stay, make facts unknown, alter terms or expire the review and prove authorization/write eligibility is blocked. Use a recorded workflow-start double to test review/authorization independently; activation of consequential v2 execution waits for US4.

### Tests for User Story 3

- [ ] T042 [P] [US3] Extend `web/tests/contract/booking-api.test.ts` and `web/tests/contract/booking-auth-api.test.ts` for complete v2 review/authorization/start requests, owner/guest boundary, exact-set/subset rejection, every bound material-field change, idempotent request replay, expiry and preserved original v1 hashes; assert zero writes for ineligible/chat-only input.
- [ ] T043 [P] [US3] Add `web/tests/unit/booking-coverage.test.ts` for absent outbound/intercity/return legs, missing stay nights/room-party coverage, paid/free/unknown activity classification, bundled products, unsupported required transfer, real timing/hard constraints and confirmed-only trips; no generic acknowledgement can satisfy an unknown required fact.
- [ ] T044 [P] [US3] Extend `web/tests/integration/booking-review.test.tsx` and `web/tests/integration/booking-authorization.test.ts` for full route/party/component display, estimate changes, missing trusted prerequisites, current-time expiry, invalidation, one full-trip action, guest linking and replay-safe authorization; test review/start records independently of provider write implementation.

### Implementation for User Story 3

- [ ] T045 [US3] Extend accepted itinerary/travel evidence in `web/domain/trip/itinerary.ts`, `web/domain/trip/schema.ts` and proposal validation in `web/domain/trip/proposal.ts` with optional “bookingDisposition: required | not_required | unknown” plus source/verification only where not derivable; enforce “Missing legacy classification remains unknown unless authoritative facts prove otherwise” through existing versioned proposals, not inferred waivers.
- [ ] T046 [US3] Implement pure `web/domain/trip/booking-coverage.ts` reusing feasibility and existing issue shapes; entries retain requirementId/sourceRefs/componentIds/issues, kind “transport, accommodation, activity” and coverage “missing, covered_unverified, eligible_unbooked, confirmed, not_required, blocked”; derive absent legs/stay-night/room-party/paid activity needs, count each required interval once, count bundle prices once, and fingerprint policy/version/mapping/material evidence rather than polling timestamps.
- [ ] T047 [US3] Extend `web/domain/booking/authorization.ts` with “schemaVersion: 2”, complete requirement mapping, provider/offer/inventory/date/party/occupancy/service/property/fare/customer-money/material-term/evidence binding and disposition “already_confirmed | to_book”; retain the exact v1 parser/hash, bind non-sensitive/opaque prerequisite versions, and enforce totalPrice as to-book sum, exact non-reversible IDs and “continuationOf”/“rootAttemptId” null initially and server-derived for recovery.
- [ ] T048 [US3] Append `web/server/db/migrations/015_whole_trip_terms.sql` and extend `web/server/db/types.ts` for replay-safe authorization identity, terms version/continuation lookup and immutable full-trip review metadata in existing records; preserve immutable historic JSON/hash, confirmations and manual/automatic policy, and add only necessary uniqueness/indexes rather than a new booking hierarchy.
- [ ] T049 [US3] Extend `web/server/db/booking-repository.ts` and safe terms/status projection in `web/domain/booking/authorization.ts` and `web/domain/booking/schema.ts` for v1/v2 reads, complete report/commitment basis and trusted prerequisite completion state; provider economics, raw identity/payment values and unrestricted nested text cannot reach browser/agent output.
- [ ] T050 [US3] Extend `web/domain/booking/revalidate.ts`, `web/server/workflows/revalidate-activities.ts` and `web/server/workflows/booking-contract.ts` to derive complete requirements before/after read-only supplier revalidation, reuse canonical read semantics, emit unknown for unavailable evidence/exception, validate actual hard constraints/timing/party/material terms/readiness and expose v2 terms only for a complete eligible trip.
- [ ] T051 [US3] Extend `web/domain/booking/authorize.ts` using existing trip locks/idempotency repository for “(owner, trip, authorization requestId)” and full fingerprint; identical requests replay, altered facts conflict, current complete persisted terms/coverage/exact unresolved set and exact non-reversible acknowledgements are rechecked, with operation book_trip/componentId null and no client-supplied replacement terms.
- [ ] T052 [US3] Extend `web/domain/booking/start.ts` and `web/app/api/v1/trips/[tripId]/bookings/route.ts` POST to consume/replay current v2 whole-trip authorization and atomically compare the entire required to-book set before durable outbox/start; reject legacy new starts and subset filtering, preserve requested attempt identity, and keep v2 provider dispatch disabled until US4 guards/composition are complete.
- [ ] T053 [US3] Add owner-scoped GET to `web/app/api/v1/trips/[tripId]/bookings/route.ts` with repository support in `web/server/db/booking-repository.ts`; return current version/coverage, bounded active/latest attempt/history, confirmed commitments and safe statuses for reload without starting, reserving or revalidating anything merely on GET.
- [ ] T054 [US3] Complete overview/blocker/full-term presentation in `web/components/booking/booking-review.tsx`, `web/components/booking/terms-review.tsx` and `web/app/trips/[tripId]/booking/page.tsx`; reuse route/party/component summaries and authentication shell, meaningful names/provider/property/date/party labels, estimates/current amounts, fee inclusion, exact total/currency, missing requirements and partial/non-reversible disclosures without subset controls.
- [ ] T055 [US3] Extend `web/components/booking/booking-console.tsx` and `web/components/booking/authorization-form.tsx` with schema-validated durable review restore, actual current-time expiry and trip-event invalidation, stable authorization/start request IDs and one explicit full-trip authorize/start action; failed/unknown/incomplete reviews cannot be acknowledged into eligibility and polling cannot extend validity.
- [ ] T056 [US3] Extend `web/domain/booking/invalidate.ts` and existing mutation safeguards in `web/domain/trip/commit.ts` for every v2 material fact including provider/offer/party/dates/terms/total/currency/non-reversible conditions; preserve proven same-attempt status advances and prevent trip undo/restore from changing provider commitments.
- [ ] T057 [US3] Extend trusted prerequisite handling in `web/server/supply/payment.ts`, `web/server/supply/transactions.ts` and `web/server/workflows/revalidate-activities.ts` to resolve opaque versioned traveller/payment readiness references only server-side; absent approved trusted sources block booking with safe reasons, no browser/agent PII collection or synthetic live substitution is introduced, and ephemeral secrets remain erased and absent from workflow history.
- [ ] T058 [US3] Update canonical v2/coverage/snapshot contracts in `contracts/trip-domain/web-api.openapi.yaml`, `contracts/trip-domain/snapshot-v1.schema.json` and `contracts/supply/README.md` through existing generators; extend `web/tests/integration/migration-compatibility.test.ts` with fresh/upgrade/legacy terms/hash/read/reconciliation fixtures while retaining separately authorized cancellation/reschedule compatibility.
- [ ] T059 [US3] Extend `web/tests/e2e/booking-auth.spec.ts` and `web/tests/e2e/booking.spec.ts` for guest/account return, complete review/current-term differences/expiry, exact single authorization/start record, blocked incomplete trips and no subset controls; use deterministic seeded review and recorded workflow start until US4, and do not claim provider confirmations from these review-only checks.
- [ ] T060 [US3] Execute T042–T044 and T058–T059 checks plus material-term tampering/expiry cases, recording SC-005 zero unauthorized writes, exact authorization replay and outstanding US4 execution activation in `specs/003-supplier-mcp-booking/evidence/whole-trip-review.md`; preserve unrun participant/live gates.

**Checkpoint**: Complete-trip review and exact authorization are independently proven; incomplete trips cannot begin execution. Do not activate consequential v2 writes until US4 is complete, even if review passes.

## Phase 6: User Story 4 — Understand and recover from a booking attempt (Priority: P1)

**Goal**: Safely execute one user-facing whole-trip attempt, preserve partial success and provider truth, and offer complete-trip recovery without blind retries or subset checkout.

**Independent Test**: Seed v2 terms and inject deterministic partial failure, timeout-after-commit, no idempotency/status, invalidation, contradictory evidence and restart. Reopen/reconcile/continue the full trip; confirmed bookings persist, unknown actions never repeat, and no confirmed component enters new writes or payable remainder.

### Tests for User Story 4

- [ ] T061 [P] [US4] Extend `web/tests/integration/booking-workflows.test.ts` and `web/tests/integration/booking-authorization.test.ts` with at least 100 duplicate/concurrent/two-authorization/restart/timeout/continuation cases, including crash windows, expiry/edit before dispatch, no-idempotency possible commit and confirmed-but-changed terms; assert durable provider action counts and outcomes, not private call order.
- [ ] T062 [P] [US4] Extend `web/tests/integration/provider-callbacks.test.ts` and `web/tests/contract/supply-transactions.test.ts` for authenticated status/callback evidence after expiry/invalidation, duplicate/contradictory callbacks, malformed responses and unsupported status; no confirmation may disappear or unsafe retry become enabled.
- [ ] T063 [P] [US4] Add `web/tests/e2e/whole-trip-recovery.spec.ts` and extend `web/tests/unit/booking-continuation.test.tsx` for meaningful partial/uncertain/not-attempted labels, reload restoration, support path, full-trip continuation/remainder and preserved confirmed commitments without component checkout.

### Implementation for User Story 4

- [ ] T064 [US4] Extend `web/server/supply/transactions.ts` and existing provider transaction factories with canonical immutable provenance routing, verified capability/readiness, opaque trusted prerequisite inputs and safe typed outcomes; remove type-only transfer-to-booking assumptions and ensure read/MCP code cannot import or invoke restricted writes.
- [ ] T065 [US4] Implement approved Booking.com Demand order/status mappings behind `web/server/supply/providers/booking-transactions.ts` and focused restricted client `web/server/supply/providers/booking-transaction-http.ts`; test documented payload/outcome/auth/timeout mappings with synthetic wire fixtures, require separate order access and trusted prerequisites, and explicitly block unavailable operations rather than claiming read credentials permit booking.
- [ ] T066 [US4] Implement approved Duffel order/status/payment-related mappings behind `web/server/supply/providers/duffel-transactions.ts` and `web/server/supply/providers/duffel-transaction-http.ts`; preserve exact accepted offer/service/customer terms and safe key/status behavior, keep payment/identity opaque and server-only, and test timeout-after-commit/non-commit outcomes without assuming provider-wide idempotency.
- [ ] T067 [US4] Implement approved GetYourGuide Partner API transaction/status mappings behind `web/server/supply/providers/getyourguide-transactions.ts` and `web/server/supply/providers/getyourguide-transaction-http.ts`; keep any required cart/reservation sequencing entirely inside the authorized workflow, bind its material conditions before authorization, and mark unsupported/unapproved transaction/status operations blocked without exposing them to discovery.
- [ ] T068 [US4] Extend `web/server/supply/providers/trainline-transactions.ts` with deterministic order/status/idempotency cases and approved partner-client mappings only when supplied; keep absent wire/access/market/status prerequisites explicitly blocked in `specs/003-supplier-mcp-booking/evidence/trainline-access.md`, with manual recovery for unsupported status and no fabricated endpoint/key semantics.
- [ ] T069 [US4] Append `web/server/db/migrations/016_booking_attempt_guards.sql` and extend `web/server/db/booking-repository.ts`, `web/server/db/types.ts` for cross-attempt component/requirement confirmed/in-flight guards, immutable parent/root lineage, safe evidence-conflict state and atomic resolved evidence/confirmation/claim release in existing tables; a fresh authorization/new key cannot clear a possible prior commit.
- [ ] T070 [US4] Harden dispatch in `web/server/workflows/book-activities.ts` with common trip/transaction/claim lock order, atomic authorization/version/coverage/readiness/expiry/prerequisite checks and fixed fingerprint/claim before the network call; block conflicting material edits/competing continuations while dispatched/unknown and keep provider calls outside database transactions.
- [ ] T071 [US4] Make durable outcome/confirmation/duplicate-guard persistence and resolved-claim release atomic across `web/server/workflows/book-activities.ts`, `web/domain/booking/apply-outcomes.ts` and `web/server/db/booking-repository.ts`; enforce “Recording authenticated truth cannot depend on execution authority being active”, retain confirmed-but-changed evidence, and show projection action required instead of dropping truth or overwriting an unrelated trip edit.
- [ ] T072 [US4] Extend status/callback reconciliation in `web/server/workflows/recover-booking.ts`, `web/server/supply/callbacks.ts` and `web/server/workflows/book-activities.ts` to preserve authenticated truth after expiry/invalidation, deduplicate conflicting evidence, retain unresolved claims and require definitive non-commit evidence before any retry; missing status or elapsed time yields manual support, never renewed authority.
- [ ] T073 [US4] Extend existing `web/domain/booking/revalidate.ts`, `authorize.ts`, `start.ts` and `web/server/db/booking-repository.ts` for server-derived continuationOf/rootAttemptId, locked prior claims, full current requirement review and exact all-unresolved write set; enforce “Confirmed commitments excluded from writes/new amount”, fresh whole-trip authorization and cross-attempt exclusivity rather than a selected-component retry API.
- [ ] T074 [US4] Extend `web/server/workflows/book-trip.ts`, `web/server/workflows/outbox-dispatcher.ts` and `web/server/workflows/booking-contract.ts` to execute each eligible component at most safely once, preserve successful siblings after definitive failure, stop remaining writes on uncertainty/changed basis, recover durable starts/replay without repeating writes and derive not-attempted separately from failed.
- [ ] T075 [US4] Compose deterministic transaction doubles and approved real restricted clients in `web/server/workflows/worker-entry.ts` and `web/workers/booking/index.ts`, using existing activity injection and worker-only credentials; register actual providers instead of an empty registry, allow v2 dispatch only after guard readiness, and keep live operations blocked independently until verified prerequisites exist.
- [ ] T076 [US4] Extend `web/components/booking/status.tsx`, `web/components/booking/recovery.tsx` and `web/components/booking/booking-console.tsx` to restore owner-visible durable/root/continuation results with meaningful names, confirmed/failed/uncertain/action-required/not-attempted text, committed versus new amounts, status checking/support/return-to-planning and one whole-trip continuation; retain separate explicit exact-action cancellation/reschedule boundaries without automatic compensation.
- [ ] T077 [US4] Run T061–T063 against the actual deterministic worker/database, exercise crash points before/after provider confirmation/local projection and >=100 concurrency/replay cases, and record SC-006 zero duplicate bookings plus preserved truth after invalidation/expiry in `specs/003-supplier-mcp-booking/evidence/transaction-safety.md`; skipped suites are not acceptance.
- [ ] T078 [US4] Complete real deterministic whole-trip success, partial/uncertain reload/status/recovery and full continuation browser journeys from `web/tests/e2e/booking.spec.ts` and `web/tests/e2e/whole-trip-recovery.spec.ts`; record confirmed-commitment preservation, no subset checkout and linked remaining-payment review in `specs/003-supplier-mcp-booking/evidence/recovery.md` before enabling v2 execution outside tests.

**Checkpoint**: One complete user-facing attempt safely represents non-atomic provider outcomes; possible commits cannot be repeated, confirmations remain visible, and complete-trip continuation is possible only after safe reconciliation and fresh consent.

## Phase 7: User Story 5 — Accessible operation and truthful claims (Priority: P2)

**Goal**: Complete every journey with keyboard/screen-reader/mobile operation and make actual provider readiness evident. Accessibility basics and truthful mode labels are required in earlier phases too; this phase certifies and closes the whole journey.

**Independent Test**: Traverse discovery, selection, complete review, authorization and partial/uncertain recovery using keyboard/screen reader at 320px and desktop; inspect all provider/mode/limitation states and the separate implementation/live evidence ledger.

### Tests for User Story 5

- [ ] T079 [P] [US5] Extend `web/tests/e2e/accessibility.spec.ts` and `web/tests/unit/accessibility-css.test.ts` for discovery/booking/recovery focus order, accessible labels/status/errors, expiry/change announcements, contrast and explicit 320px/wide viewports; require no essential clipping and no focus jumps from polling.
- [ ] T080 [P] [US5] Extend `web/tests/contract/provider-readiness.test.ts` and add `web/tests/integration/provider-readiness-ui.test.tsx` for every support/access/mode/prerequisite state; verify factories/credentials/deterministic results cannot assert live verification and blocked operations have safe explanations and no enabled writes.

### Implementation for User Story 5

- [ ] T081 [US5] Close keyboard/screen-reader/focus/status issues in `web/components/trip-workspace/offer-research.tsx`, `web/components/agent/conversation.tsx` and `web/components/trip-workspace/workspace.tsx` using existing controls; preserve DOM reading order, accessible comparison details and non-disruptive current-version announcements.
- [ ] T082 [US5] Close booking/recovery accessibility/responsiveness issues in `web/components/booking/booking-review.tsx`, `authorization-form.tsx`, `terms-review.tsx`, `status.tsx`, `recovery.tsx` and `web/app/globals.css`; support logical visible focus/error-summary focus after blocked submit, screen-reader status and full 320px readability without a redesign/new UI toolkit.
- [ ] T083 [US5] Complete safe provider capability/mode/prerequisite presentation in `web/components/trip-workspace/offer-research.tsx`, `web/components/booking/booking-console.tsx` and `web/server/supply/read.ts`, keeping “supported | unsupported | unknown” separate from “unconfigured | configured_unverified | verified | blocked” and surfacing missing identity/payment/access prerequisites without secrets or fake live fallback.
- [ ] T084 [US5] Run T079–T080 plus manual keyboard/screen-reader checks across the four journeys, narrow/wide layouts and guest/account return, recording browser/assistive technology, fixes and zero critical/serious findings for SC-008 in `specs/003-supplier-mcp-booking/evidence/accessibility.md`; unavailable manual checks remain unrun/unchecked, not certified by automated tests alone.
- [ ] T085 [US5] Conduct the specified ten-participant evaluation using `specs/003-supplier-mcp-booking/quickstart.md` and record SC-002 comparison <=2min, SC-004 review/authorization <=3min and SC-007 partial/uncertain understanding <=1min with >=9/10 success in `specs/003-supplier-mcp-booking/evidence/usability.md`; use available consenting participants only, do not send recruitment messages without authority, and leave this task unchecked if participant evidence is unavailable.

**Checkpoint**: Whole-journey accessibility and provider claims have explicit evidence. Missing human/live evidence remains a named release gate rather than a fabricated pass or an implementation defect hidden by simulation.

## Phase 8: Polish and Cross-Cutting Verification

**Purpose**: Finish shared privacy, timing, compatibility and release evidence without broad refactoring or deployment side effects.

- [ ] T086 [P] Run/extend nested-output/log/telemetry privacy canary coverage in `web/tests/integration/booking-privacy.test.ts`, `agent/tests/test_telemetry_redaction.py` and `agent/tests/unit/test_langsmith.py`; prove SC-009 and safe audit correlation across discovery/proposals/authorization/attempt/status/continuation, recording `specs/003-supplier-mcp-booking/evidence/privacy.md` without raw secrets/terms/PII.
- [ ] T087 [P] Extend/run controlled search/booking responsiveness coverage in `web/tests/performance/planning-load.ts` and `web/tests/integration/booking-latency.test.ts`, measuring SC-001 p95 <=10s/all <=12s and provider-independent safe outage/retry deadlines; record `specs/003-supplier-mcp-booking/evidence/performance.md` without claiming external provider service levels.
- [ ] T088 [P] Extend/run `agent/tests/evaluation/test_context_budget.py` for the four typed tools, bounded offer/detail summaries, stable prompt prefixes and volatile evidence placement; record schema/context token delta, caching impact and retained recommendation behavior in `specs/003-supplier-mcp-booking/evidence/context-budget.md` without new context infrastructure.
- [ ] T089 [P] Update `docs/operations.md`, `.env.example`, `infra/compose/compose.yml` and `specs/003-supplier-mcp-booking/quickstart.md` for existing-process composition, credential separation/scope limitations, capability activation, missing trusted prerequisites, uncertainty/support, compatible rollout/rollback and legacy reconciliation; no new service/port and no live deployment/credentials/approval are implied by documentation.
- [ ] T090 Run full contract generation/drift, lint, typecheck, unit/integration/evaluation/Temporal and browser commands from `package.json` and `specs/003-supplier-mcp-booking/quickstart.md`; record exact commands, results, non-skipped counts and outstanding human/provider gates in `specs/003-supplier-mcp-booking/evidence/validation.md`, resolving failures before declaring implementation complete.
- [ ] T091 Prove fresh/upgrade and compatible-reader/worker rollout/rollback behavior for all new migrations in `web/tests/integration/migration-compatibility.test.ts` and legacy workflow fixtures in `web/tests/integration/booking-workflows.test.ts`; record `specs/003-supplier-mcp-booking/evidence/compatibility.md`, preserving v1 hashes/confirmations and blocking old/new unsafe starts while allowing reconciliation, without migrating a production database.
- [ ] T092 Reconcile FR-001–FR-031 and SC-001–SC-010 against executed evidence in `specs/003-supplier-mcp-booking/evidence/acceptance.md` and `evidence/provider-readiness.md`; distinguish implemented, deterministic, provider-test/live-access and externally blocked capabilities, record all unrun participant/access checks honestly, and keep release activation closed wherever prerequisites remain unmet.

## Dependencies and Execution Order

### Phase and story graph

```text
Setup T001–T003
    -> Foundation T004–T008
        -> US1 T009–T032 (discovery MVP)
            -> US2 T033–T041 (recommendation/selection)
            -> US3 T042–T060 (complete review/authorization)
                -> US4 T061–T078 (execution and recovery)
US1 + US2 + US3 + US4 -> US5 T079–T085
All implementation/story checks -> Polish T086–T092
```

US2 and US3 can be validated with fixed offers/seeded accepted trips independently of one another. Their source edits share contract/proposal/component files, so the default safe execution order is US2 then US3. US4 needs US3 v2/coverage types and records but no recommendation service. Human/provider activation gates do not block implementing safe deterministic paths; they do block claiming their corresponding success/activation.

### Required task prerequisites and parallel waves

| Work | Prerequisites / order |
| --- | --- |
| T002 and T003 | T001; T003 can overlap T002 because files differ |
| Foundation | All setup, then T004 -> T005 -> T006 -> T007 -> T008 |
| US1 tests T009/T010/T011 | Foundation; parallel test files, written before relevant implementation |
| US1 contracts/fixtures | T009–T011 authored, then T012 -> T013 -> T014 -> T015 -> T016 |
| Provider reads T017/T018/T019/T020 | T012–T016; parallel only in their own provider/client files, no shared fixture/generator edits |
| US1 integration | All four provider tasks, then T021 -> T022 -> T023 -> T024 -> T025 -> T026 -> T027 -> T028 -> T029 -> T030 -> T031 -> T032 |
| US2 tests T033/T034 | US1 contracts/runtime complete; independent files permit parallel work |
| US2 implementation | T033–T034 authored, then T035 -> T036 -> T037 -> T038 -> T039 -> T040 -> T041 |
| US3 tests T042/T043/T044 | US1 complete; parallel test files. Seeded trip means no US2 dependency for test authoring |
| US3 implementation | T042–T044 authored, then T045 -> T046 -> T047 -> T048 -> T049 -> T050 -> T051 -> T052 -> T053 -> T054 -> T055 -> T056 -> T057 -> T058 -> T059 -> T060; serialize shared-file edits with US2 |
| US4 tests T061/T062/T063 | US3 complete; parallel files; write before dispatch/recovery changes |
| US4 implementation | T061–T063 authored, then T064 -> T065 -> T066 -> T067 -> T068 -> T069 -> T070 -> T071 -> T072 -> T073 -> T074 -> T075 -> T076 -> T077 -> T078 |
| US5 tests T079/T080 | Earlier journeys complete; parallel distinct files |
| US5 completion | T079–T080 authored, then T081 -> T082 -> T083 -> T084 -> T085 |
| Cross-cutting T086/T087/T088/T089 | Story implementation and automated checks complete; parallel distinct sources/evidence files, no concurrent suite changes in shared files |
| Final checks | T086–T089 complete, then T090 -> T091 -> T092; record any unavailable T084/T085/live gates explicitly, never mark them passed |

Contract/model changes precede services, services precede endpoints/integration, and acceptance runs follow implementation. Within each story, passing the new behavioral tests is required at its checkpoint. Migration 014 precedes 015, which precedes 016; reserve/recheck the next migration number if the repository changes before implementation, never rewrite an applied migration.

### Parallel execution examples per story

- **US1**: Author T009 supply/readiness contracts, T010 Python MCP protocol tests and T011 workspace/access tests concurrently after foundation. After T016, implement T017 Booking.com, T018 Duffel, T019 GetYourGuide and T020 Trainline only in their disjoint provider/client files; serialize canonical generation afterward.
- **US2**: Author T033 Python decision evaluations and T034 web proposal/selection regressions together after US1. Recommendation policy and its integration then proceed in order to avoid simultaneous graph/contract edits.
- **US3**: Author T042 booking API contracts, T043 pure coverage cases and T044 review/authorization tests concurrently. Coverage/terms/revalidation/UI then follow the declared dependencies; no competing migration/schema writers.
- **US4**: Author T061 workflow race tests, T062 callback/transaction contracts and T063 recovery UI/browser tests concurrently. Execute fault/race cases only after guards/outcome recording and deterministic worker wiring are ready.
- **US5**: Author T079 accessibility journeys and T080 readiness UI/contracts concurrently. Human evaluation may be prepared while automated verification runs, but no task authorizes contacting participants or suppliers; only record observed results from available authorized sessions.

## Requirement Coverage

| Specification area | Implementation and proof tasks |
| --- | --- |
| FR-001–002 reuse/access | T004–T008, T014–T015, T021–T025, T029–T030, T034, T037–T038, T042, T051–T053 |
| FR-003–010 discovery/capabilities/Tavily | T009–T032, T080, T083, T092 |
| FR-011–014 decisions/workspace/state | T027–T029, T031–T041, T055–T056, T081 |
| FR-015–020 complete review/authorization | T042–T060, dispatch checks T061/T070 and exact continuation T073 |
| FR-021–026 safe execution/recovery | T061–T078, compatibility T091 |
| FR-027–029 privacy/credentials/audit | T003/T005/T008, T013/T021–T024, T049/T057, T064–T075, T086/T089/T092 |
| FR-030 accessibility/responsiveness | Basic UI T027/T040/T054–T055/T076, cross-journey T079–T084 |
| FR-031 deterministic acceptance | T007/T009–T011/T016/T031–T034/T042–T044/T059–T063/T077–T080/T086–T092 |
| SC-001 search bounds | T021/T032/T087 |
| SC-002 comparison and SC-004 complete review | T027/T054–T055 plus participant evidence T085 |
| SC-003 decision/question quality | T033/T035–T036/T041 |
| SC-005 no unauthorized writes | T042–T044/T051–T052/T056/T059–T061/T070/T077 |
| SC-006 no duplicate writes | T061/T069–T075/T077/T091 |
| SC-007 recovery understanding | T063/T076/T078 plus participant evidence T085 |
| SC-008 accessibility | T079–T084 |
| SC-009 data exposure/audit | T005/T049/T057/T086 |
| SC-010 truthful provider readiness | T003/T013/T017–T020/T026/T065–T068/T080/T083/T092 |

The data-model constraints are carried explicitly into T004 (money/strict accepted component), T012/T014/T016 (offer evidence, nullable unknowns, immutable revisions/stable party), T013/T083 (provider identity/support/access), T045/T046 (classification/coverage fields), T047/T049/T051 (v2 terms, dispositions, totals/acknowledgements/lineage/replay), and T069–T074 (attempt/claim/outcome transitions). No optional missing legacy fact becomes a verified pass.

## Implementation Strategy

### MVP first

Complete setup/foundation and US1 (T001–T032). Demonstrate four-source deterministic search/comparison/details/read-only revalidation from the real workspace with safe uncertainty and unchanged trip state. Live operations remain gated. This is a discovery MVP, not a complete booking launch; it does not waive the remaining user request.

### Incremental delivery

Add US2 decisions while preserving existing proposal policy. Complete US3 full review/authorization with no consequential activation until US4 passes. Then enable deterministic execution/recovery and prove partial/uncertain safeguards. Finish US5 whole-journey certification and cross-cutting checks. Reuse existing configuration/readiness to gate operations; no new deployment stack or parallel state system is warranted.

### Completion and external gates

Implementation tasks are satisfied by the specified code and non-skipped deterministic/contract evidence, not by external commercial approval. T020/T068 can complete explicit fail-closed Trainline behavior and approved client injection while missing partner documents remain a separately recorded activation gate; absent mappings must never be described as implemented live integration. Public-documented provider transports require actual wire mapping/tests even without live credentials, rather than substituting an unavailable stub for the requested code. Obtain/verify any gated live mapping before claiming that capability ready.

T084 manual accessibility and T085 participant outcomes remain unchecked if not executed. Provider credentials/commercial access, approved wire contracts, actual market coverage and trusted sensitive-data prerequisites remain explicit external activation gates in the readiness ledger. Do not obtain credentials, contact third parties, deploy or perform live consequential tests solely because these tasks exist. An unavailable external/human gate must be reported with its effect; it is never silently counted as passed or used to fabricate favourable behavior.

## Generation Validation

| Group | Tasks |
| --- | --- |
| Setup | 3 |
| Foundation | 5 |
| US1 — Discovery/comparison | 24 |
| US2 — Preference decisions | 9 |
| US3 — Complete review/authorization | 19 |
| US4 — Safe execution/recovery | 18 |
| US5 — Accessibility/truthful claims | 7 |
| Polish/cross-cutting verification | 7 |
| Total | 92 |

Generation review: 92 sequential unique IDs, 22 dependency-qualified parallel tasks, all tasks unchecked with file paths, all story-phase tasks labelled, all 31 functional requirements and 10 success criteria mapped. Independent tests and parallel examples are defined for every story. No unresolved design placeholder remains. These are task-document quality checks, not executed product tests or completed tasks. No extension hooks are configured.
