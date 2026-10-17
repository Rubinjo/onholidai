# Quickstart validation: supplier MCP and whole-trip booking

This guide is for implementation validation. Planning did not install dependencies, run migrations, deploy services, execute product tests or establish provider access. Commands use existing scripts; feature cases below must be added to those suites during implementation. A green existing suite without the new scenarios is not feature acceptance.

## Prerequisites

- Node.js 24, pnpm 12, Python 3.13/uv, Docker Compose v2 and installed Playwright browsers.
- Synthetic local configuration from `.env.example` and existing [operations guide](../../docs/operations.md). Keep auth, service and diagnostic keys distinct and do not print secrets. Use no production traveller/payment data.
- Isolated database test roles/URLs: `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_MIGRATION_URL`, `TEST_DATABASE_APP_URL`, `TEST_DATABASE_WORKER_URL`, provisioned with `infra/postgres/test-roles.sql`. Missing variables skip database tests and do not establish acceptance.
- Existing schema currently ends at migration 013. Implement reviewed additive changes before running the new scenarios. Prove both a fresh database and upgrade from existing saved trips/bookings.
- Implementation pins FastMCP in `agent/pyproject.toml`/`agent/uv.lock`, extends canonical generated contracts and injects deterministic read/transaction providers in existing roots. No separate MCP server process is started; the agent constructs an in-memory server/client per run.

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

Run focused existing suites after extending them:

```powershell
uv run --project agent pytest agent/tests/contract agent/tests/integration agent/tests/evaluation agent/tests/unit
pnpm --dir web test tests/unit/provider-fixtures.test.ts tests/integration/booking-authorization.test.ts tests/integration/booking-workflows.test.ts tests/integration/booking-review.test.tsx tests/integration/booking-privacy.test.ts
pnpm --dir web exec playwright test tests/e2e/booking.spec.ts tests/e2e/booking-auth.spec.ts
```

Run the full `pnpm test:e2e` once the new supplier/workspace journeys are added. Use the existing Playwright projects for desktop/mobile engines and an explicit 320px case. For production-mode secure cookies follow the established local HTTPS setup in [guest quickstart](../002-platform-guest-planning/quickstart.md); do not weaken production cookie/Origin protections.

## Deterministic acceptance scenarios

Fixtures extend existing provider doubles and test helpers; fault selection is test injection or test-only fixture configuration, never a production browser-controlled provider endpoint. Use a controlled clock and synthetic identities. Keep model decisions reproducible through current evaluation doubles/fixed offer sets. See [data model](data-model.md) and [contracts](contracts/supplier-discovery.md) for invariants rather than duplicating schemas here.

| Scenario | Action | Expected result/evidence |
| --- | --- | --- |
| Four-source discovery | Search a seeded dated trip; inspect flight/rail/stay/activity details including hotel/apartment/another property type | Relevant grouped offers, source/mode, real property type, customer facts/unknowns; zero trip mutations/provider transactions |
| Real MCP surface | Use FastMCP client list/call against the per-run server in contract tests | Exactly four allowed tools, typed args/results, no transaction names or context/secret args |
| Isolation | Run two owners simultaneously; submit forged extra context, cross-trip and ungranted cross-run offer refs; revoke/stale one grant | Requests denied without leakage, other run unaffected; valid selected-reference import only after server validation |
| Honest failure | Inject no matches, outage, rate limit, timeout, missing auth/approval/coverage, malformed response | Distinct safe outcomes, successful partial sources retained, accepted trip/version unchanged |
| Unknown facts | Omit service time, mandatory fee, terms, age eligibility, room occupancy/accessibility evidence | Null/unverified displayed, no invented favourable value; incomplete offer cannot become eligible component |
| Preference decisions | At least 20 dominant/equivalent/competitive/material-missing cases across four categories | Suitable no-question selection for dominant/equivalent cases; focused question only for material uncertainty/trade-off; hard constraints preserved |
| Existing policies | Select a current offer under automatic then historical manual run policies, repeat with stale trip version | Current validated proposal/summary/history behavior preserved; stale change rejected; no booking |
| Strict completeness | Remove return leg/stay nights/paid activity mapping; include unsupported required transfer or missing trusted booking prerequisite | Exact blocker, no subset terms, no authorization/write even if remaining components pass |
| Complete review | Revalidate fully evidenced deterministic trip, review and authorize once | Full route/party/components/terms and exact total, one whole-trip action, durable exact v2 basis |
| Stale/tampered consent | Change every material field in turn, expire between writes, submit subset/chat-only request | Zero unauthorized writes, old authority invalidated, fresh complete review required |
| Duplicates/races | At least 100 duplicate/two-tab/two-authorization/restart/continuation/timeout cases, including no-idempotency provider | No duplicate commitment, durable guard blocks possible prior commit, outcome restored on reload |
| Partial/uncertain | Confirm one, fail another; separately timeout after commit, contradictory callback and unsupported status | Confirmations preserved; failed/uncertain/not-attempted distinct; status before retry or explicit manual support |
| Crash and expired authority | Crash between provider response and local projection; reconcile after expiry/invalidation or unrelated trip edit | Truth durably restored without reactivating writes or overwriting material edits; no claim-release duplicate window |
| Full continuation | Resolve uncertainty, review all unresolved eligible requirements with existing confirmations | Entire trip shown, exact remainder, fresh full-trip authorization, confirmed entries excluded from writes, linked history and no subset checkout |
| Privacy | Inject protected canaries in nested details/text/errors and inspect outputs/log/telemetry test sinks | No supplier cost/margin/secrets/payment/sensitive identities; safe audit evidence still correlates attempts |
| Access/responsiveness | Guest -> sign-in/link -> booking; keyboard/screen-reader at 320px and desktop | Plan preserved, no auth-induced booking, usable focus/status/errors, no essential clipping |

Measure 95% usable searches <=10s and all bounded results/failures <=12s under controlled responsive doubles. Record endpoint/UI timing separately from provider calls; do not infer provider service levels. Include zero-write counters for every read and blocked authorization, and durable provider action counts in safety cases.

## Human and live activation gates

Run the specified ten-person evaluation for comparison within 2 minutes, complete review/authorization within 3 minutes, and partial/uncertain understanding within 1 minute; require at least 9/10 per relevant outcome. Run manual keyboard/screen-reader and automated accessibility checks with zero critical/serious findings. Existing Playwright presence alone does not establish accessibility acceptance; record exact checks and browser/assistive technology used.

Record executed commands, non-skipped counts, outcomes, measurements and safe evidence references under this feature's implementation evidence during implementation. Keep unrun/failed checks explicit. Record schema/context token changes and cache-prefix impact. No participant result or accessibility/provider certification is claimed by this plan.

For each provider, separately record implemented, deterministically verified, provider-test/live-access verified and externally blocked capabilities. Apply [provider readiness](contracts/provider-readiness.md): approved credentials, commercial rights, partner wire contracts, supported market/property/party coverage, mandatory prices/terms, rate limits, status/idempotency semantics and trusted identity/payment prerequisites must be established before activation. Trainline partner documentation and GetYourGuide reseller access cannot be inferred from adapter factories. No synthetic success, redirect checkout, consumer automation or unknown provider operation counts as completed live whole-trip booking.

## Rollout verification

Use one migration runner and compatible web/agent/worker revisions. Prove old snapshots/offers and v1 authorizations remain readable with original hashes; old pending starts require fresh review while status reconciliation still works. Activate v2 generation/starts only after compatible workers are deployed. On rollback disable new starts and continue reconciliation; never delete confirmations, alter old hashes or replay provider writes.
