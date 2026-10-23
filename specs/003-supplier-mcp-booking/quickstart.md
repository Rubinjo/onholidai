# Quickstart validation: supplier MCP and whole-trip booking

This guide is for implementation validation. Planning did not install dependencies, run migrations, deploy services, execute product tests or establish provider access. Commands use existing scripts; feature cases below must be added to those suites during implementation. A green existing suite without the new scenarios is not feature acceptance.

Revised 2026-10-23: current acceptance covers Duffel Flights, Nuitee stays and Viator activities with no active rail provider. Duffel Stays is historical-read/approved-status-only; Nuitee Flights/Experiences are inactive, not fallback lanes. Booking.com/Trainline remain deferred and GetYourGuide replaced. Existing completed task evidence predates this scope. Start at T094 -> T095 -> revised T017 -> T096 -> T097 -> T098, including the non-skipped foundation gate, before remaining browser/latency acceptance. This guide does not imply Nuitee configuration or code is already supported.

## Prerequisites

- Node.js 24, pnpm 12, Python 3.13/uv, Docker Compose v2 and installed Playwright browsers.
- Synthetic local configuration from `.env.example` and existing [operations guide](../../docs/operations.md). Keep auth, service and diagnostic keys distinct and do not print secrets. Use no production traveller/payment data.
- Isolated database test roles/URLs: `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_MIGRATION_URL`, `TEST_DATABASE_APP_URL`, `TEST_DATABASE_WORKER_URL`, provisioned with `infra/postgres/test-roles.sql`. Missing variables skip database tests and do not establish acceptance.
- Supplier research adds migration 014 and whole-trip review adds migration 015 without editing migrations 001-013 or rewriting historical terms/hashes. Use an isolated migrated database and prove both a fresh database and upgrade from existing saved trips/bookings.
- Implementation pins FastMCP in `agent/pyproject.toml`/`agent/uv.lock`, extends canonical generated contracts and injects deterministic read/transaction providers in existing roots. No separate MCP server process is started; the agent constructs an in-memory server/client per run.
- Current live setup needs Duffel/Nuitee/Viator prerequisites: distinct Duffel read/write keys in web/worker respectively and each provider's shared Nuitee/Viator key in trusted processes only, never agent/browser. Set Nuitee sandbox/production explicitly; do not infer any product or booking/payment approval from key presence. Trusted nationality, room occupancy/child ages and an approved payment path must be established without guessed or exposed sensitive data. Verify fixed read allowlists and per-operation access before enabling live calls. No Duffel Stays/Nuitee Flights/Experiences or deferred-provider accounts are required.
- Nuitee hotel prebook is documented checkout-session creation. Until explicit approved semantics establish a no-hold/no-reservation/no-payment variant, exclude it from discovery/revalidation, return unsupported live revalidation and block exact stay authorization. `usePaymentSdk=false` is not a safety waiver. Deterministic eligible booking cases use explicit safe evidence, not a claim that live prebook is approved.

Run from the repository root. Do not run concurrent migration jobs. Use either host apps or container apps, not two conflicting copies.

## Setup and checks

After implementation and reviewed lockfiles:

```powershell
pnpm install --frozen-lockfile
uv sync --project agent --frozen
pnpm test:contracts
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migrations
pnpm test:temporal
```

Contract checks cover current exporters plus new public supply and MCP fixtures. Confirm no required suites were skipped and that dependency resolution did not introduce optional FastMCP task/cloud/LLM integrations. Use the existing Windows pytest temp-path workaround from operations only when needed.

Build/run the current local stack with reviewed migration changes:

```powershell
docker compose -f infra/compose/compose.yml --profile infrastructure up -d
docker compose -f infra/compose/compose.yml --profile infrastructure --profile migrations build migrate
docker compose -f infra/compose/compose.yml --profile infrastructure --profile migrations run --rm migrate
docker compose -f infra/compose/compose.yml --profile infrastructure --profile applications up -d --build
docker compose -f infra/compose/compose.yml --profile infrastructure --profile booking up -d --build booking-worker
```

Set `PROVIDER_MODE=deterministic` through existing composition. Ensure deterministic transaction clients are actually registered: the pre-feature worker's empty registry is not a successful booking demonstration. For host mode, use existing `pnpm dev`, `pnpm dev:agent`, and `pnpm --dir web booking:worker` in separate terminals with equivalent safe configuration. No extra port or MCP service is required.

### Bounded US1 discovery checks

With the isolated test database URLs configured, the current discovery gate is:

```powershell
pnpm test:contracts
pnpm --dir web test:foundation
pnpm --dir web test tests/contract tests/integration/supplier-research-access.test.ts tests/integration/offer-research.test.tsx tests/integration/workspace-propagation.test.tsx tests/unit/config.test.ts tests/unit/application.test.ts tests/unit/provider-fixtures.test.ts
uv run --no-sync --project agent pytest agent/tests/integration/test_supplier_mcp.py agent/tests/contract/test_contract_export.py -q
pnpm --dir web typecheck
pnpm --dir web exec playwright test tests/e2e/supplier-search.spec.ts --workers=1
```

Run the browser command with healthy deterministic web/agent services and a
separate migrated browser database. For development mode use a matching
`localhost` browser/auth origin; wait for route hydration and avoid concurrent
heavy test workers. Do not increase product deadlines to hide cold development
compilation. All five configured projects run both supplier cases; the explicit
fault/prerequisite/legacy UI case uses a 320px viewport.

The supply-read contract includes 20 controlled-clock current-source samples
with two hanging stays sources. Exact p95/maximum are both 8,000 ms against
10,000/12,000 ms limits. This does not measure real-provider or browser
end-to-end latency. Final results and superseded failures are recorded in
[discovery evidence](evidence/discovery.md#2026-10-23-t028t031t032-discovery-acceptance).
These discovery checks do not certify booking, live access or participant
outcomes; continue with the remaining feature gates separately.

### Bounded US2 recommendation checks

US2 uses the existing refinement request with
`selectedOffers: [{ offerRef, revision }]`, not browser-supplied component prices
or a second offer store. Selections must come from completed current-version
research. Unknown required facts may produce a focused chat question; selection
itself is neither trip acceptance nor booking authorization.

With all four isolated test database URLs set in the same shell:

```powershell
uv run --no-sync --project agent pytest agent\tests -q
pnpm --dir web test tests/contract/refinement-api.test.ts tests/integration/trip-planning.test.ts tests/integration/refinement.test.ts tests/integration/offer-research.test.tsx tests/integration/workspace-propagation.test.tsx tests/unit/automatic-result.test.ts tests/unit/evaluation-fixtures.test.ts
pnpm --dir web test:foundation
pnpm test:contracts
pnpm --dir web corpus:check
pnpm --dir web typecheck
uv run --no-sync --project agent pyright agent\src agent\tests
```

The 26 fixed decision cases require 18 appropriate selections and eight focused
material questions, including no questions for dominant/equivalent options.
Additional tests cover retained budgets, child ages, flight constraints, partial
research, exact MCP imports, immutable policy, trusted repricing, stale source
revisions, summaries and actual undo with zero booking transactions.
An explicit instruction to keep rail unresolved permits supported planning but
never removes the required rail constraint or establishes booking eligibility.
See [US2 evidence](evidence/recommendations.md) for the recorded denominator,
final results and certification limits. Booking and participant validation
remain separate gates.

Run focused existing suites after extending them:

```powershell
uv run --project agent pytest agent/tests/contract agent/tests/integration agent/tests/evaluation agent/tests/unit
pnpm --dir web test tests/unit/provider-fixtures.test.ts tests/integration/booking-authorization.test.ts tests/integration/booking-workflows.test.ts tests/integration/booking-review.test.tsx tests/integration/booking-privacy.test.ts
pnpm --dir web exec playwright test tests/e2e/booking.spec.ts tests/e2e/booking-auth.spec.ts
```

Run the full `pnpm test:e2e` once the new supplier/workspace journeys are added. Use the existing Playwright projects for desktop/mobile engines and an explicit 320px case. For production-mode secure cookies follow the established local HTTPS setup in [guest quickstart](../002-platform-guest-planning/quickstart.md); do not weaken production cookie/Origin protections.

### Bounded US3 whole-trip review checks

US3 implements review, exact authorization and a durable non-executing start
record. Consequential v2 supplier dispatch and whole-trip recovery activation
remain blocked until US4. No approved live final-terms or traveller/payment
readiness source is installed by these checks. In particular, Nuitee rates,
prebook and payment-SDK disablement are not final checkout approval.

With all four isolated database test URLs configured:

```powershell
pnpm --dir web test tests/unit/booking-coverage.test.ts tests/unit/booking-continuation.test.tsx tests/integration/booking-authorization.test.ts tests/integration/booking-workflows.test.ts tests/integration/booking-review.test.tsx tests/integration/booking-privacy.test.ts tests/integration/booking-planning-identity.test.ts tests/integration/booking-latency.test.ts tests/integration/migration-compatibility.test.ts tests/contract/booking-api.test.ts tests/contract/booking-auth-api.test.ts --maxWorkers=2
pnpm test:contracts
pnpm --dir web typecheck
pnpm --dir web build
```

Run the browser journeys against the production HTTPS harness described above,
with a deterministic agent and a separate fully migrated loopback database named
exactly `onholidai_us3_browser`. Set `US3_REVIEW_FIXTURE_DATABASE_URL` to that
disposable database and `PLAYWRIGHT_BASE_URL` to the matching HTTPS/auth origin.
For an untrusted local test certificate outside CI, set
`PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true`; do not change application cookie or Origin
protections.

```powershell
pnpm --dir web exec playwright test tests/e2e/booking.spec.ts tests/e2e/booking-auth.spec.ts --grep-invert '@us4' --workers=1
```

All five configured projects cover review, 320px layout, keyboard consent,
estimate differences, expiry, durable reload and real guest/account continuation.
The positive review browser case intercepts consent/start POSTs with a
database-restricted CLI calling the real domain functions and synthetic approved
readiness. Reads, authentication and negative incomplete-trip authorization use
the application. Credentialed HTTP contract tests independently exercise the
real positive routes. One saved authorization/transaction/outbox and zero
component attempts demonstrate record creation, not supplier confirmation.
Guest linking preserves the draft even when required research evidence still
needs clarification; it does not require an automatically accepted estimate.

See [whole-trip review evidence](evidence/whole-trip-review.md) for current
results and the independent US4, live and participant gates.

## Deterministic acceptance scenarios

Fixtures extend existing provider doubles and test helpers; fault selection is test injection or test-only fixture configuration, never a production browser-controlled provider endpoint. Use a controlled clock and synthetic identities. Keep model decisions reproducible through current evaluation doubles/fixed offer sets. See [data model](data-model.md) and [contracts](contracts/supplier-discovery.md) for invariants rather than duplicating schemas here.

| Scenario                    | Action                                                                                                                                                        | Expected result/evidence                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current-source discovery    | Search a seeded dated trip with Duffel flights, Nuitee stays and Viator activities, supported sourced property variants and no inactive keys                  | Relevant grouped offers with exact source/product/mode, occupancy, customer facts/unknowns; zero trip mutations/provider transactions or inactive-product calls                                                         |
| No rail data                | Request rail-only and mixed research; plan/refine/finalize supported trips, then a trip with an explicit rail constraint                                      | Explicit unsupported/deferred rail, supported results retained and useful non-rail planning; no invented rail prices/times, synthetic rail, replacement source, repeated credential request or silent mode substitution |
| Product readiness           | Block Nuitee stays while Duffel works, then reverse; omit Nuitee Flights/Experiences access and Viator booking entitlement                                    | Independent operation/environment outcomes, supported results retained, no global failure, shared verification or fallback; no entitlement inferred from keys                                                           |
| Credential boundary         | Inject synthetic separate Duffel keys and each Nuitee/Viator shared write-capable key; attempt transaction/prebook calls through discovery                    | Shared references allowed only in trusted composition, Duffel write key absent from web, fixed allowlists reject prebook/holds/payments/bookings/arbitrary forwarding, zero writes or exposed keys                      |
| Stay quote completeness     | Supply cheapest listing data, selected multi-room offer, included/excluded charges, property payments, missing nationality/ages and unverified prebook        | Unknown/prerequisite facts stay explicit; exact safe minor-unit totals without double counting; missing final terms/payment safety blocks authorization, never invents facts or calls transactional prebook             |
| Real MCP surface            | Use FastMCP client list/call against the per-run server in contract tests                                                                                     | Exactly four allowed tools, typed args/results, no transaction names or context/secret args                                                                                                                             |
| Isolation                   | Run two owners simultaneously; submit forged extra context, cross-trip and ungranted cross-run offer refs; revoke/stale one grant                             | Requests denied without leakage, other run unaffected; valid selected-reference import only after server validation                                                                                                     |
| Honest failure              | Inject no matches, outage, rate limit, timeout, missing auth/approval/coverage, malformed response                                                            | Distinct safe outcomes, successful partial sources retained, accepted trip/version unchanged                                                                                                                            |
| Unknown facts               | Omit service time, mandatory fee, terms, age eligibility, room occupancy/accessibility evidence                                                               | Null/unverified displayed, no invented favourable value; incomplete offer cannot become eligible component                                                                                                              |
| Preference decisions        | At least 20 dominant/equivalent/competitive/material-missing cases across flights/stays/activities and unavailable rail                                       | Suitable no-question selection for dominant/equivalent cases; focused question only for material uncertainty/trade-off; hard constraints preserved without rail data                                                    |
| Existing policies           | Select a current offer under automatic then historical manual run policies, repeat with stale trip version                                                    | Current validated proposal/summary/history behavior preserved; stale change rejected; no booking                                                                                                                        |
| Strict completeness         | Review a complete supported non-rail trip without deferred keys, then remove return leg/stay nights/paid activity mapping or require unresolved rail/transfer | Deferred-provider absence alone does not block a complete supported trip; genuinely missing/unsupported requirements block the whole attempt with exact resolution, no subset terms or writes                           |
| Legacy provenance           | Load saved Duffel Stays/Booking.com/Trainline/GetYourGuide offers/confirmations; attempt refresh/new dispatch and approved existing status reconciliation     | Original identities/commitments preserved, no relabelling as Nuitee/current inventory, inactive refresh/writes blocked, no onboarding/fallback; approved status reconciliation still records truth                      |
| Complete review             | Revalidate fully evidenced deterministic trip, review and authorize once                                                                                      | Full route/party/components/terms and exact total, one whole-trip action, durable exact v2 basis                                                                                                                        |
| Stale/tampered consent      | Change every material field in turn, expire between writes, submit subset/chat-only request                                                                   | Zero unauthorized writes, old authority invalidated, fresh complete review required                                                                                                                                     |
| Duplicates/races            | At least 100 duplicate/two-tab/two-authorization/restart/continuation/timeout cases, including no-idempotency provider                                        | No duplicate commitment, durable guard blocks possible prior commit, outcome restored on reload                                                                                                                         |
| Partial/uncertain           | Confirm one, fail another; separately timeout after commit, contradictory callback and unsupported status                                                     | Confirmations preserved; failed/uncertain/not-attempted distinct; status before retry or explicit manual support                                                                                                        |
| Crash and expired authority | Crash between provider response and local projection; reconcile after expiry/invalidation or unrelated trip edit                                              | Truth durably restored without reactivating writes or overwriting material edits; no claim-release duplicate window                                                                                                     |
| Full continuation           | Resolve uncertainty, review all unresolved eligible requirements with existing confirmations                                                                  | Entire trip shown, exact remainder, fresh full-trip authorization, confirmed entries excluded from writes, linked history and no subset checkout                                                                        |
| Privacy                     | Inject protected canaries in nested details/text/errors and inspect outputs/log/telemetry test sinks                                                          | No supplier cost/margin/secrets/payment/sensitive identities; safe audit evidence still correlates attempts                                                                                                             |
| Access/responsiveness       | Guest -> sign-in/link -> booking; keyboard/screen-reader at 320px and desktop                                                                                 | Plan preserved, no auth-induced booking, usable focus/status/errors, no essential clipping                                                                                                                              |

Measure 95% usable searches <=10s and all bounded results/failures <=12s under controlled responsive doubles. Record endpoint/UI timing separately from provider calls; do not infer provider service levels. Include zero-write counters for every read and blocked authorization, and durable provider action counts in safety cases.

## Human and live activation gates

Run the specified ten-person evaluation for comparison within 2 minutes, complete review/authorization within 3 minutes, and partial/uncertain understanding within 1 minute; require at least 9/10 per relevant outcome. Run manual keyboard/screen-reader and automated accessibility checks with zero critical/serious findings. Existing Playwright presence alone does not establish accessibility acceptance; record exact checks and browser/assistive technology used.

Record executed commands, non-skipped counts, outcomes, measurements and safe evidence references under this feature's implementation evidence during implementation. Keep unrun/failed checks explicit. Record schema/context token changes and cache-prefix impact. No participant result or accessibility/provider certification is claimed by this plan.

For each active provider/product/operation, separately record implemented, deterministically verified, provider-test/live-access verified and externally blocked capabilities. Apply [provider readiness](contracts/provider-readiness.md): approved credentials, commercial rights, partner wire contracts, supported market/property/party coverage, mandatory prices/terms, rate limits, status/idempotency semantics and trusted identity/payment prerequisites must be established before activation. Duffel Stays requires its own access approval; Viator's single key does not establish booking-tier entitlement. Booking.com/Trainline access is deferred, not a current gate; GetYourGuide is replaced. No synthetic success, redirect checkout, consumer automation or unknown provider operation counts as completed live whole-trip booking.

## Rollout verification

Use one migration runner and compatible web/agent/worker revisions. Prove old snapshots/offers and v1 authorizations remain readable with original hashes; old pending starts require fresh review while status reconciliation still works. Activate v2 generation/starts only after compatible workers are deployed. On rollback disable new starts and continue reconciliation; never delete confirmations, alter old hashes or replay provider writes.
