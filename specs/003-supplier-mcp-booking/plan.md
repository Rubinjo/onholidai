# Implementation Plan: Supplier MCP Search and Whole-Trip Booking

**Branch**: `main` (current checkout) | **Feature**: `003-supplier-mcp-booking` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification and the user's reuse-first planning principles. Setup reports the feature identifier as `BRANCH: 003-supplier-mcp-booking`; `git branch --show-current` confirms the checkout is `main`. No branch was created or switched by planning.

**Revision**: 2026-10-23. Amend the existing feature in place: Duffel Flights, Nuitee stays, Viator activities, no active rail provider. Preserve all completed task lines and dated evidence; revise remaining work and add correction tasks for already-implemented configuration/composition/contracts. Nuitee Flights is a possible future complement, not an active second source; Experiences is evaluated but not selected. No application change or activation is claimed.

## Summary

Extend the existing supply read port and normalized offers, expose four read-only tools with in-memory FastMCP in the Python agent, retain signed web callbacks and Tavily Search API. Keep clients, normalization, pricing, access and transactions in existing TypeScript boundaries. Extend current recommendation, proposal and workspace capabilities.

Complete the existing booking page and harden its authorization/Temporal workflow with derived completeness, versioned material terms, durable reload, duplicate prevention and reconciliation/continuation. No new service, database, queue, workspace package, frontend library, checkout or orchestrator. Deterministic acceptance and external provider approval remain separate.

## Technical Context

**Language/Version**: Existing TypeScript 6.0.3/Node.js 24 and Python >=3.13,<3.14; no version upgrades.
**Primary Dependencies**: Existing Next.js/React, Zod, Kysely, Better Auth, TanStack Query, Temporal; FastAPI, Pydantic, HTTPX, LangGraph. Add standalone `fastmcp` and required transitives only; resolve/pin a compatible release in the existing UV lock. No optional cloud/task/LLM integrations.
**Storage**: Existing PostgreSQL 18/PostGIS and trip/run/offer/proposal/booking/idempotency/audit/outbox records; additive migrations after 013. No MCP session database.
**Testing**: Vitest/Testing Library, Playwright, pytest, Pyright, Ruff, ESLint, TypeScript, current contract generators, isolated database helpers and Temporal tests; deterministic controlled clocks/faults.
**Target Platform**: Existing web, Python agent and TypeScript worker deployments; browsers from 320px; no MCP network endpoint.
**Project Type**: Existing web application, conversational agent and workflow worker.
**Performance Goals**: Deterministic p95 search <=10s, bounded response <=12s; current 8s provider deadline inside overall budget. No automatic retries by default; at most one rate-limit-directed read retry if it fits. Retain the existing maximum-four-adapter safety ceiling with three active product lanes, 32 total offers and 32 booking components.
**Constraints**: No read-side holds/reservations; no transaction tools/secrets in agent/MCP. Unknown facts stay unknown. Server-enforced completeness/exact authorization, integer-safe money and one exact payable currency. Preserve guest linking, proposal policy, immutable evidence and confirmed commitments.
**Scale/Scope**: Three active providers covering three product lanes: Duffel flight, Nuitee accommodation, Viator activity. Duffel Stays is compatibility/reconciliation-only; Nuitee Flights/Experiences are inactive, with no automatic fallback. Booking.com and Trainline are deferred; GetYourGuide is replaced. Retain rail in compatibility/query types to return explicit unsupported outcomes, not to request replacement inventory. Actual provider quotas/property coverage are configured evidence, not scaling assumptions.

## Constitution Check

Pre-research gate: PASS. Post-design gate: PASS. No exception requested.

| Principle                 | Evidence and required gate                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| I. Optimize for deletion  | Four thin MCP handlers; current ports/UI; one pure coverage evaluator; no new service/package/orchestrator.                   |
| II. Explicitness          | Typed schemas, injected clients, immutable per-run context, closed allowlist; no global current-user state or TypeScript any. |
| III. Accessibility        | Keyboard, screen-reader, visible focus, status/errors and 320px acceptance.                                                   |
| IV. Context budget        | Four bounded schemas, stable instructions, bounded offer summaries/references; measure token/cache impact.                    |
| V. Behavior tests         | Deterministic discovery, preference, authorization, partial/unknown, crash/replay and duplicate safety cases.                 |
| VI. Verifiable increments | Discovery, decisions, workspace, complete review and safe recovery have independent proof.                                    |
| VII. Authoritative state  | Reuse proposal/commit/version/undo; research cannot mutate accepted trip.                                                     |
| VIII. Transactions        | Reuse exact authorization, claims and Temporal; dispatch validation; truth recording independent of write authority.          |
| Compatibility/privacy     | Preserve legacy parsers/hashes, additive migrations, explicit safe projections and opaque sensitive prerequisite references.  |

## Project Structure

### Documentation (this feature)

```text
specs/003-supplier-mcp-booking/
  spec.md, plan.md, research.md, data-model.md, quickstart.md
  contracts/supplier-discovery.md
  contracts/whole-trip-booking.md
  contracts/provider-readiness.md
  checklists/requirements.md
```

The existing task list is revised in place; completed work remains historical evidence, not proof of compliance with changed requirements.

### Source Code (repository root)

```text
agent/
  pyproject.toml, uv.lock
  src/onholidai_agent/
    integrations/supplier_mcp.py             # new thin per-run facade
    integrations/runtime.py, api/store.py    # reuse signed reads and Tavily
    models/, tools/, graph/                  # extend current contracts/decisions
  tests/
web/
  domain/trip/                              # shared fields, coverage, proposals
  domain/booking/, domain/pricing/          # terms/authorization/outcomes/projection
  server/supply/                            # extend existing ports/provider clients
    providers/nuitee-read.ts, nuitee-http.ts # focused stays reads, proposed
    providers/nuitee-transactions.ts         # restricted stays transactions, proposed
    providers/nuitee-transaction-http.ts     # fixed approved booking/status calls
  server/auth/, server/agent-client/        # reuse resource/run access
  server/workflows/, server/db/             # current workflow, records, migrations
  app/api/v1/, app/trips/[tripId]/           # current route families
  components/trip-workspace/, booking/      # current layout/components/shared UI
  tests/
contracts/supply/, contracts/agent-api/, contracts/trip-domain/
scripts/, docs/operations.md, infra/compose/compose.yml
```

**Structure Decision**: Keep the current workspace. One thin MCP module and one pure coverage module are the only new conceptual modules; transports/routes/tests remain under established directories. No packages layer. Browser calls web directly; MCP and browser invoke the same supply/domain functions.

## Phase 0: Research outcome

[research.md](research.md#2026-10-23-provider-selection-revision) records the current comparison and primary sources: retain Duffel/Viator, replace stays with Nuitee. Shared authentication is not an operational or commercial reason for replacing the existing flight/activity paths. Nuitee production product enablement, mandatory pricing/payment facts, prebook read safety and transaction reconciliation remain explicit fail-closed activation gates. In particular, public hotel docs do not yet establish a safe prebook variant for read-only revalidation; discovery can ship without falsely claiming live booking eligibility.

## Phase 1: Design

### Contract ownership

Use [data-model.md](data-model.md) and the [discovery](contracts/supplier-discovery.md), [booking](contracts/whole-trip-booking.md), [readiness](contracts/provider-readiness.md) contracts. They describe proposed changes; implementation updates canonical schemas/generation/drift checks.

- Keep Zod authoritative for supply/trip/booking facts, with current exporters/checkers extended for public supply shapes. Python validates shared wire shapes and cross-language fixtures without duplicating normalization. Retain Pydantic ownership of run/tool-call contracts.
- Add read-only `supplier_research` to existing run purposes/checks/exporters. Reuse lifecycle, quotas, grants and offer records; it can answer/clarify and publish research references, never propose mutations or authorize. Workspace selection requests an ordinary refinement under existing application policy.
- Extend the single PlanningOffer with nullable unknown discovery facts and revalidation evidence, sharing current component/price definitions. Only complete candidates materialize into strict accepted components. No invented times/prices/fees or random adult IDs per search.
- Derive coverage from accepted route, stay intervals, party allocation and itinerary. Add minimal accepted booking classifications for paid/free/self-arranged facts not otherwise derivable. Legacy unknowns block booking; detect missing return legs/stay nights even without components.
- Add v2 whole-trip terms binding provider provenance, all material facts, coverage, commitments, remaining amount and continuation lineage. Preserve original v1 parser/hash/history. New starts require v2; pending legacy writes stop for fresh review, but reconciliation remains enabled.

### Request and credential flow

Agent run -> in-process MCP client/server -> existing signed web read endpoints -> existing supply port -> provider clients. Trusted owner/trip/version/run is captured outside model args. Web checks every call, grant and offer-record access. Reuse audience web and trip:read with route-level restrictions; no new signing mechanism or network MCP auth. Python receives no supplier secrets.

Browser -> existing resource/session/Origin guard -> same supply/domain reads and safe projections. Research persists evidence only; selection uses existing proposal/commit policy. Booking -> existing account/link boundary -> persisted complete revalidation -> replay-safe exact authorization -> start -> current Temporal/transaction adapters. Duffel read keys remain in web and separate write keys only in worker. Nuitee and Viator each use their own shared upstream key in trusted web-read and worker clients, never Python/MCP/browser. Both read clients expose fixed side-effect-free endpoint/method allowlists and cannot import restricted transaction clients. Different secret references do not create different upstream permissions; allow a shared reference within Nuitee or Viator, not within Duffel. Track Nuitee sandbox/production explicitly and never infer Flights/Experiences entitlement from hotel access. Missing booking/payment approval still blocks writes.

The MCP facade never imports transaction adapters. Booking revalidation reuses read-client normalization/semantics; MCP research cannot mint authorization. Tighten allowlisting of nested supplier fields/text, not only price projection.

### Supplier/product composition and no-rail planning

- Use canonical IDs `duffel` (flight), `nuitee` (accommodation), `viator` (activity) plus component type for operation routing. Preserve historical Duffel accommodation identity; never alias it to Nuitee. Extend existing provider enums, typed readiness, canonical generated contracts and cross-language fixtures without adding a plugin framework. Do not broaden active products just because the provider name is recognized.
- Retain current Duffel flight clients. Implement focused `nuitee-read.ts` / `nuitee-http.ts` for property discovery/detail and `POST /hotels/rates` on the documented search host. Resolve trusted location, nationality, room occupancy/child ages; block missing prerequisites instead of fabricating them. Preserve actual property type, hotel/room/rate/offer IDs, sourced optional session ID, room/guest allocation, dates, expiry, refund/meal/payment terms and mandatory included/excluded taxes/fees/deposits/property charges. A cheapest listing rate is not a selected multi-room quote. Use a six-second shopping deadline within the eight-second source/twelve-second overall bounds and existing result/size limits; no catalogue ingestion or unbounded fan-out.
- Hotel `POST /rates/prebook` on the booking host creates a checkout session and may initialize payment; keep it outside the read allowlist unless approved semantics prove a no-hold/no-reservation/no-payment variant. `usePaymentSdk=false` is not sufficient evidence. A fresh rates response cannot be promoted to final live-revalidated checkout terms without affirmative evidence. Until a safe exact-terms path exists, declare revalidation unsupported and block stay authorization; do not weaken FR-004/016/018/027 or use a worker prebook to change already-authorized material terms. Restricted prebook/book/payment handling, where approved, stays inside the exact authorized transaction workflow and requires fresh review after any material change.
- Implement Viator Partner API product/option detail, availability and pricing in focused `viator-read.ts` / `viator-http.ts`; no holds, carts or booking calls in reads. Implement approved booking/status only in restricted `viator-transactions.ts` / `viator-transaction-http.ts`, with required booking-question readiness resolved through trusted opaque references. Affiliate content access is not booking entitlement.
- Compose only Duffel flight, Nuitee stay and Viator activity lanes in deterministic and live discovery/worker roots. Add restricted `nuitee-transactions.ts` / `nuitee-transaction-http.ts` with approved booking/status schemas and trusted guest/payment references; do not copy Duffel Orders semantics or infer idempotency from `prebookId`. Keep timeout-after-commit uncertain until authenticated correlation proves truth, otherwise manual support/no retry. Maintain the maximum-four-adapter safety ceiling and 32-offer/32-component bounds with fair requirement/product allocation.
- Every requested unsupported rail search returns an explicit `unsupported`/deferred capability outcome, including rail-only requests. Do not register synthetic Trainline inventory or a replacement, call deferred providers, or label absent rail as no matches.
- Extend current estimate/refine/finalize and runtime capability handling so no-rail planning succeeds when supported offers satisfy accepted constraints. Missing rail alone is not global research failure. An explicit rail requirement remains unresolved; preserve existing proposal/clarification rules, never silently substitute flights or invent travel times/prices. Tavily remains advisory, not rail inventory.
- Keep legacy Duffel Stays, Booking.com (`booking.com`/`booking`), Trainline and GetYourGuide in saved-evidence readers and approved status reconciliation only. No new Duffel stay search/refresh/book calls or fallback; replacement uses current Nuitee research, existing proposal/version rules and fresh authorization. Do not relabel saved offers/confirmations or require inactive access for current setup. Retain only code needed for compatibility/reconciliation; remove unused active wiring. Future Nuitee Flights/Experiences or deferred-provider activation is separately scoped, not speculative adapters now.

### Eligibility and safe execution

Compute coverage before and after supplier reads. Block missing requirements, unknown material costs/terms, hard constraints, unsupported booking and absent trusted identity/payment prerequisites. Planning acknowledgements cannot certify booking eligibility. Recompute the full required set at authorize/start. At each dispatch check current ownership/version or proven same-attempt status advances, immutable terms, expiry, readiness and confirmed/in-flight guards.

Keep provider calls outside database transactions. Atomically claim/fix the authorized dispatch basis under existing locks; block material edits/competing writes while dispatched/unknown. Atomically persist result/evidence/confirmation/attempt and duplicate guard before releasing a resolved claim. Append existing booking-workflow trip versions when safe. If a later edit prevents projection, retain provider truth and owner-visible action-required state without overwriting the edit or enabling another write. Expired/invalid authorization cannot prevent recording authenticated provider truth or enable new execution.

Continuation locks prior attempts/claims, resolves uncertainty, derives all unresolved required work and uses existing revalidate/authorize/start with parent/root references. Require definitive non-commit evidence before any further write for a dispatched component. Fresh full-trip authorization excludes confirmed commitments from new charges/writes. Cross-attempt guards block competing continuations. Definitive failure may coexist with other authorized successes; uncertainty/changed basis stops remaining writes. No blind retry or automatic compensation.

### Interface

**Demo-only priority override (2026-10-24):** T099-T101 add an explicitly opted-in
browser-only branch to the existing booking page, separate from the real review
component and its effects. Reuse the trip overview, Georgia typography, green/white
tokens and existing buttons; use one receipt-like estimate/confirmation panel rather
than redesigning the workspace. Keep all simulated progress/consent in React state,
clean up its timer on unmount and key it by trip/version. The server passes only the
parsed non-secret `BOOKING_DEMO_ENABLED` flag after normal trip access checks.
Guests may preview their own trips without account linking; cancelled trips still
redirect. No API, SSE, storage, worker, provider or payment integration is added.
Keep live discovery and real booking endpoints/gates unchanged. This supersedes
production execution as the immediate delivery priority, not its safety requirements.

**Authorized Duffel follow-up (2026-10-24):** reuse the existing optional
credential-role schema after sandbox search/detail proof. The user selected
`DUFFEL_TRANSACTION_SECRET` as the explicitly referenced discovery credential,
with the worker reference omitted. No new flag, resolver, transport, shared-key
exception or schema is needed. Keep provider/demo modes unchanged, prove web/worker
isolation and exact source currency through synthetic regressions, and preserve
unknown customer totals/terms. Do not invent EUR/GBP conversion or live readiness.

Add bounded research/comparison within current details/conversation panes; retain the workspace/map layout. Reuse useTrip, React Query, ComponentDetails, buttons, clarification, summaries/checkpoints. Key results by trip/version, ignore late responses and preserve accepted state on failure. Show requirement groups, source/property type, customer amounts/currency, unknown facts, freshness, rationale and safe retry.

Extend current booking route/auth/finalization shell with route/party/component overview, missing requirements, estimate changes, full material terms, commitments, remaining payable amount and partial/non-reversible disclosures. One explicit whole-trip action authorizes then starts with persistent request IDs. Use actual current-time expiry; invalidate on trip events/reload/submit. Restore durable attempts before offering authorization. Reuse status/recovery components with meaningful confirmed/failed/uncertain/not-attempted labels, status checking, support and one complete-trip continuation. No subset checkout.

Use existing responsive CSS/UI primitives, accessible names, visible focus and semantic summaries. Announce statuses without polling focus jumps; focus blocked-submit error summary. No redesign or new UI dependency.

### Delivery increments and proof

| Increment             | Deliverable and verification                                                                        | Requirements             |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------ |
| 1. Supplier reads     | Current contracts/clients, deterministic cases, approved transports, unknown facts, safe projection | FR-001–010, 027–029, 031 |
| 2. MCP/decisions      | Actual MCP protocol, concurrent isolation, preferences/clarification, Tavily/proposal regressions   | FR-002–014, 028–031      |
| 3. Workspace          | Research runs, comparison/details/selection, stale/failure and accessibility cases                  | FR-011–014, 030          |
| 4. Complete review    | Coverage, v2 terms/migrations, page, durable read, authorization replay/subset rejection            | FR-015–020, 027–031      |
| 5. Execution/recovery | Worker composition, atomic guards, post-expiry truth, continuation, crash/concurrency               | FR-021–026, 027–031      |

Each is independently testable in deterministic mode. Enable transactions only after complete review/execution gates. SC-001/003/005/006/009/010 use controlled acceptance; SC-002/004/007 require ten representative participants. SC-008 requires automated/manual accessibility evidence. Skipped suites are not passes. [quickstart.md](quickstart.md) provides commands and scenarios.

### Compatibility and rollout

Append migrations after 013 for necessary offer revisions, run purpose checks, authorization replay identity, version/lineage and duplicate guards in current records. Prefer existing JSON fields; add columns/indexes only for required uniqueness, immutability or lookup. Do not rewrite applied migrations or old authorization hashes. Preserve manual/automatic policies; absent new facts decode unknown.

Deploy compatible readers/workers before enabling v2 starts using current deployment workflow. Pause/drain legacy pending writes for fresh review while keeping reconciliation. Old workers cannot consume v2 execution. Rollback disables new starts and reconciles outstanding attempts without deleting evidence. Prove fresh/upgrade/legacy-read paths.

Revise the existing typed Duffel/Viator configuration/readiness for canonical `nuitee` accommodation and the current product matrix through T094-T098. Preserve completed T093's separate Duffel/shared Viator policy, extend shared-key handling to Nuitee, and keep Duffel Stays compatibility-only. Test before editing `web/server/config.ts` and injection in web/worker roots; regenerate existing contracts without duplicating schemas. Keep examples secret-free and remove inactive onboarding requirements. Wire deterministic transaction doubles into the existing worker root: an empty registry cannot demonstrate end-to-end booking. Add real transports only from approved wire contracts; document unsupported prebook safety, exact terms, payment/status and trusted identity prerequisites. Live approvals remain separate release gates.

## Complexity Tracking

No constitutional violations. Necessary additions are a thin MCP facade, a pure coverage evaluator, small current-record/contract extensions and FastMCP. New supply service, provider hierarchy, saga engine, recommendation service, state store, remote MCP auth and UI redesign were rejected in research.
