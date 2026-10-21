# Research: Supplier MCP and whole-trip booking

Date: 2026-10-17; supplier-scope revision: 2026-10-19. Repository inspection and primary-source documentation inform these decisions. No provider credentials were inspected or exercised. Live approvals are external prerequisites, not unresolved architecture choices. Current scope is Duffel Flights/Stays and Viator activities; Booking.com and Trainline are future additions, and GetYourGuide is replaced.

## 1. Retain the current service and package boundaries

**Decision**: Keep provider clients, canonical offer normalization, trip validation, pricing, ownership, and transactions in the existing TypeScript web/worker code. Keep conversational decisions in the existing Python agent. Add no workspace package or deployed service.

**Evidence**: `pnpm-workspace.yaml` contains only `web`; shared artifacts already live in `contracts/`. `web/server/supply/read.ts`, `offers.ts`, `providers/adapter.ts`, and `transactions.ts` provide read and restricted transaction ports. `agent/integrations/runtime.py` (under `agent/src/onholidai_agent/`) already delegates offers through `WebRunStore.search` to the internal planning-search route. `application.ts` accepts injected planning providers. Provider factories are adapter shells, not completed commercial transports. `worker-entry.ts` currently composes an empty transaction registry, so the stock worker cannot book merely because transaction factories exist.

**Rationale**: Moving supplier logic to Python or creating another supply service would duplicate the authoritative normalization, pricing, and access boundaries. Explicitly injecting real clients and deterministic doubles fits existing composition.

**Alternatives considered**: New `packages/supply`, Python provider implementations, generic provider plugin architecture, new message broker/cache, and a second orchestrator. None is necessary for two active providers, three product lanes and one first-party consumer.

## 2. Use FastMCP in memory, with trusted per-run context

**Decision**: Add the standalone `fastmcp` dependency to the existing agent and pin a Python-3.13-compatible release in its UV lock after a dependency-resolution check. Build one purpose-built server/client pair per trusted run or resume; use `Client(server)` in memory. Register only `supplier_search`, `supplier_offer_details`, `supplier_revalidate_offer`, and `supplier_capabilities`. Each handler delegates to the existing signed web read boundary. Inject/capture immutable trusted request/store dependencies outside model-visible arguments. No HTTP mount, sidecar, public MCP endpoint, session database, or new token audience is required.

**Rationale**: [FastMCP transports](https://gofastmcp.com/clients/transports) explicitly support an in-memory MCP client/server. [Dependency injection](https://gofastmcp.com/servers/dependency-injection) keeps dependencies out of tool schemas. This is a protocol layer, not a security sandbox: supplier credentials must remain in web/worker processes. The existing `WebRunStore.headers`, web `internalActor`, service-token verification, run grants, and ownership checks remain authoritative. Never keep a mutable global current-run context or assume cross-task context propagation provides isolation.

**Alternatives considered**: The TypeScript MCP SDK would colocate with providers but add a Node entry point, process/HTTP transport and authentication wiring for the Python consumer. Mounting FastMCP on FastAPI is [supported](https://gofastmcp.com/integrations/fastapi), but unnecessary for this first-party in-process consumer. Hand-written JSON-RPC would add protocol maintenance. Standalone FastMCP fits the requested preference and existing Python/Pydantic/HTTPX stack. Review its resolved dependency diff; do not add its optional cloud/task/LLM integrations ([installation](https://gofastmcp.com/getting-started/installation), [official package manifest](https://github.com/PrefectHQ/fastmcp/blob/main/pyproject.toml)).

**Validation consequence**: Test real `list_tools`/`call_tool`, concurrent owners/runs, forged context arguments, revoked grants and cross-run offers. Direct handler tests alone do not establish MCP behavior. If remote MCP is requested later, treat that as a separately reviewed transport/auth change; [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices) requires appropriate token audience and rejects token passthrough.

## 3. Evolve the single offer contract instead of inventing another offer system

**Decision**: Extend `PlanningOffer`, the existing read port, and its canonical schema with evidence, property/service type, strict material facts, capability/readiness, and incomplete discovery facts. Reuse the component field definitions and public price projection. Incomplete source dates/details can be nullable in the discovery representation of that same offer; conversion to an accepted component still requires the existing complete `travelComponentSchema`. No fabricated service times or new accepted-trip state. Add detail/revalidation methods to the current read port rather than route read research through transaction adapters.

**Evidence**: `providers/adapter.ts` currently substitutes query-date noon for missing service times, generates adult IDs on each search, and treats prices as estimated. `offers.ts` embeds a complete component and permits only estimated/quoted/expired prices. `read.ts` collapses many failures to unavailable and deduplicates only provider/offer ID. `planningDetailsSchema` already has accommodation type, nullable facts, verification and unavailable-facts fields. `projectCustomerSnapshot` replaces prices but spreads other data; new supplier text/fields require explicit allowlisting, not an assumption that price projection sanitizes arbitrary payloads.

**Rationale**: Keep a single normalization path and a strict materialization gate. Unknown source facts must be displayable without making incomplete components bookable. Stable references come from provider/offer, requirement and query context, not repeated random identities. Research revalidation does not mint booking authorization or update accepted components.

**Alternatives considered**: A second MCP-specific offer model, permissive raw supplier JSON, fabricated defaults, or broad nullable changes to all saved trip components. These would duplicate contracts, leak data, or weaken existing accepted-trip invariants. If small reusable schema-field extraction is necessary to express incomplete discovery, limit it to these existing offer/component schemas.

## 4. Extend the existing recommendation decision point

**Decision**: Extend `graph/estimate.py::select_quotes` and reuse it from refinement/finalization as needed. First filter proven hard failures; treat missing required evidence as unresolved; compare preference fit among viable offers and identify dominance. Stable ties use provider ID then provider offer ID within equivalent normalized terms. Ask only for a material missing traveller fact or unresolved meaningful trade-off. Use the current typed clarification/result flow and proposal application policy.

**Evidence**: `select_quotes` currently groups by `selectionGroup` and chooses a spend-based price percentile. Existing `changeProposalSchema`, `RunRepository`, `acceptProposal`, `commitTripMutation`, checkpoints and undo already validate/persist accepted changes; automatic runs are handled explicitly by migration `013_automatic_planning.sql`. Tavily remains in `integrations/tavily.py` and advisory facts remain separated in `EstimateSources.search`.

**Rationale**: A small decision-policy extension plus bounded model explanation is enough; a separate recommendation service, optimizer framework or agent approval manager is unwarranted. Never invent numerical utility thresholds that imply unknown quality is proven.

## 5. Add strict booking eligibility alongside existing feasibility

**Decision**: Extend `web/domain/trip` with a pure booking-requirements/coverage evaluator, reusing route/date/itinerary relationships, constraints, `evaluateFeasibility` facts and existing issue shapes. Do not use the planning finalization acknowledgement as booking eligibility. Derive route legs and stay-night coverage even when components are absent; explicit paid/free/unknown booking classifications for itinerary items must be part of the accepted version when not derivable. Legacy unknown classifications block booking until reviewed.

**Evidence**: `feasibility.ts` checks itinerary timing and constraints but planning can acknowledge unverified conditions. `revalidate-activities.ts` maps only `snapshot.components`, so a missing required return leg or stay is not checked. `authorize.ts` validates persisted live terms without full requirement coverage; `start.ts` filters only unbooked included components.

**Rationale**: A derived report is not a second trip store. Require exact equality between required unresolved work and authorized writes at review, authorization, start and dispatch. Existing confirmed commitments satisfy coverage only with durable matching evidence. A required transfer remains unsupported unless an actual approved capability exists; remove type-only `transfer -> booking` assumptions.

## 6. Extend exact terms and preserve immutable legacy evidence

**Decision**: Add a versioned v2 whole-trip terms variant to `authorization.ts` with provider provenance, all material facts, coverage and confirmed-commitment basis, continuation lineage and remaining payable total. Reuse canonical hashing, owner/version/operation binding, existing authorization/revalidation/transaction records and idempotency repository. Legacy terms remain readable under their original schema/hash; never rewrite historical authorization JSON or rehash it as v2. New starts require complete v2 review; pending legacy execution is safely stopped for fresh review while reconciliation remains allowed.

**Evidence**: Current terms include dates, traveller IDs, inventory/offer IDs, price, cancellation, expiry and non-reversible flags but omit provider identity and several material facts. `authorize.ts` does not make creation idempotent by `requestId`. Existing migrations make authorizations and execution bases immutable. Migration numbering currently ends at 013.

**Rationale**: This preserves evidence and existing workflows while closing subset and changed-term gaps. A new authorization service or saga is unnecessary. All browser values remain customer projections; sensitive identity/payment prerequisites use opaque server references and missing trusted data blocks booking.

## 7. Harden current write and reconciliation boundaries

**Decision**: Keep the sequential Temporal workflow and current claims, attempt records, outbox and status reconciliation. Atomically persist resolved evidence, outcome, confirmed guard and claim release in the existing database transaction boundary; if trip projection cannot safely apply, retain durable provider truth and a reconciliation-needed state. Recheck authorization/version/readiness and durable cross-attempt component claims at dispatch, with a common lock order. Recording provider truth must not depend on permission to make another write.

**Evidence**: `book-activities.ts` releases a resolved claim before confirmation and outcome application, and `recordBookingOutcome` returns when execution is not active. `apply-outcomes.ts` rejects an unrelated version advance; this must not hide a real provider confirmation. `transactions.ts::providerForComponent` maps only by type rather than immutable offer provenance. `book-trip.ts` already uses single-attempt activities and stops on unknown/action-required outcomes.

**Rationale**: Close local race/crash windows without claiming distributed atomicity. Unknown writes keep their claim until affirmative status evidence establishes truth. No provider idempotency means one write followed by reconciliation/manual action, never a blind retry. Reconciliation after expiry or invalidation must still update the owner-visible attempt without authorizing new writes or overwriting a materially edited trip.

## 8. Reuse the booking UI and full-trip continuation

**Decision**: Extend `BookingReview`, `BookingConsole`, `TermsReview`, `AuthorizationForm`, `BookingStatus`, `BookingRecovery`, `ComponentDetails` and shared UI primitives. Add an owner-scoped durable review/attempt read to the existing trip bookings route. Restore active/latest attempt before offering authorization. Continuations use existing revalidation/authorize/start with a parent attempt reference and the complete unresolved set, never a selected component list.

**Evidence**: Booking auth/linking already exists. Current terms presentation lacks useful component names and full terms; `bookingId` is component-local state; expiry is compared with a polling-updated `reviewedAt`. Failed components become snapshot `pending`, so continuation cannot simply filter `bookingStatus === unbooked`. The current recovery route supports status checking and rejects retry.

**Rationale**: Reuse components/layout, use real deadline state and server checks, show every required component and confirmed commitment, and show only remaining amounts for new actions. Do not add another checkout, component purchase flow, UI kit, or layout redesign.

## 9. Provider access findings and rollout decision

| Provider | Verified public documentation | Plan and explicit limit |
| --- | --- | --- |
| Duffel Flights | [Offers](https://duffel.com/docs/api/v2/offers) documents current offer retrieval and expiry, and warns availability can still change at booking. | Retain flight search/current-offer evidence. Use separate read/write keys as requested; verify permitted operation scope and keep write keys worker-only. Do not promise a reservation or final availability guarantee. |
| Duffel Stays | [Getting started with Stays](https://duffel.com/docs/guides/getting-started-with-stays), reviewed 2026-10-19, requires requesting Stays access and describes search, all room rates, final quote and booking as distinct steps. [Create quote](https://duffel.com/docs/api/v2/quotes/create-quote) exposes selected-rate expiry, deposits, due-at-accommodation amounts and material terms. | Implement a separate accommodation lane under provider `duffel`, not flight order mappings or Booking.com attribution. Preserve actual room/rate/occupancy and complete mandatory costs. Establish quote no-hold semantics and read-key permission before enabling read-only revalidation; do not elevate credentials to make it work. Flights access alone does not prove Stays access. |
| Viator | [Partner API overview](https://docs.viator.com/partner-api/), reviewed 2026-10-19, describes product content/availability/pricing and restricted booking/post-booking functionality. [Technical documentation](https://docs.viator.com/partner-api/technical/) states booking questions apply to Full Access + Booking affiliates and merchant partners. | Replace GetYourGuide with Viator Partner API. Model the user's single upstream key honestly: trusted read/worker injection, closed non-transactional read allowlist, no key in agent/MCP/browser. Booking-tier approval and trusted required booking-question answers remain separate prerequisites; content access cannot authorize writes or redirect checkout as a substitute. |
| Booking.com / Trainline | Previously researched providers; user explicitly defers both on 2026-10-19. | Do not build new mappings, onboard accounts or require their credentials now. No current rail replacement or synthetic rail inventory. Preserve saved attribution/confirmations and existing approved status reconciliation. Future activation is a separate feature. |
| GetYourGuide | Previously selected activity source; replaced by Viator on 2026-10-19. | No active source/fallback or new access gate. Preserve historical evidence rather than relabelling it as Viator. |

**Decision**: Implement deterministic development/acceptance for every in-scope product/operation and explicit unsupported rail behavior; add documented real transports where approved wire contracts are available and explicitly mark gated operations otherwise. Keep support/access per product and operation so Duffel Stays and Flights cannot accidentally share verification. No live deployment is accepted until operation-level access evidence, commercial approval, scope, market coverage, mandatory pricing/terms, safe write reconciliation and trusted identity/payment prerequisites are established for the actual required products, not deferred suppliers.

**Credential decision**: Current `web/server/config.ts` unconditionally rejects identical read/transaction secret references and has no Viator ID; T008 completion therefore cannot satisfy the revised setup. Add a foundation correction before story work. Duffel retains distinct upstream read/write keys; Viator may use the same reference/value in trusted read/worker clients, with an explicit read endpoint/method allowlist and no arbitrary proxy. Separate secret names or processes do not reduce upstream key scope. Missing/revoked access fails safely per product/operation, never through synthetic live fallback.

**No-rail decision**: Existing provider composition includes deterministic Trainline inventory. Replace active composition with Duffel Flights/Stays and Viator, returning explicit unsupported outcomes for rail-only and mixed requests. Extend existing agent estimate/refine/finalize paths to proceed usefully without rail when accepted constraints permit. Preserve required rail as unresolved, with no fabricated prices/times, silent mode substitution or whole-trip booking waiver. Tavily remains advisory.

**Alternatives considered**: Keeping Booking.com/GetYourGuide active, adding another rail provider, building speculative future-provider mappings, or treating two Viator secret names as independent scopes all contradict the revised scope. Fake live responses, scraping, consumer-site automation, redirect checkout, or interpreting a provider factory as live readiness fail the experience/access guarantees. External commercial gates may remain closed without leaving an architectural clarification unresolved.

## Research resolution

### T017 approval addendum (2026-10-21)

The user reports Duffel confirmed Stays quote creation has no side effects or
obligations beyond a quote record and authorizes a bounded attempt with the
existing separate read token. Accept this as user-attested implementation
approval, not independent supplier access certification. The detailed sources,
field mappings, constraints and unrun permission probe are recorded in the
[provider ledger](evidence/provider-readiness.md#t017-conditional-implementation-approval-2026-10-21).
Earlier no-hold blockers above are historical to this extent only.

Direct inspection of the public API v2 documentation's structured schema
establishes:

- [Quote creation](https://duffel.com/docs/api/v2/quotes/create-quote)
  takes `rate_id` and checks availability/total pricing; getting an existing
  quote is retrieval, not documented fresh revalidation. The schema has
  nested rate expiry, no top-level quote expiry, room count/guests/dates and no
  supplier room ID. Do not invent a quote TTL, room ID or occupancy allocation.
- Base, tax and fee amounts are included in the rate total. Deposits are
  portions of that total. Mandatory due-at-accommodation amounts are excluded
  from that total and can have a different currency. Missing/null amounts and
  unsupported currency/payment schedules remain booking blockers.
- Payment types `pay_now`, `deposit` and `guarantee` have distinct timing and
  card requirements; `pay_now` alone does not establish an exact charge date.
  Keep payment methods, mandatory conditions and cancellation timelines.
- The [holding guide](https://duffel.com/docs/guides/holding-orders-and-paying-later)
  describes flight air orders, not Stays quote holds. The
  [Stays guide](https://duffel.com/docs/guides/getting-started-with-stays)
  separates search, rates, quote and booking and still requires Stays access.
- The [rate-limit article](https://help.duffel.com/hc/en-gb/articles/10229200096786-What-is-the-API-rate-limit),
  retrieved through its [official public JSON](https://help.duffel.com/api/v2/help_center/en-gb/articles/10229200096786.json)
  after HTML returned 403, documents a default **live search** quota of 10
  requests per 60 seconds, endpoint-specific limits and `ratelimit-limit` /
  `ratelimit-reset` response headers. No global or sandbox quota is inferred.
- [Authentication](https://duffel.com/docs/api/overview/making-requests)
  distinguishes read-only/read-write tokens but does not document per-operation
  permission for these Stays POSTs.
  [Test mode](https://duffel.com/docs/api/overview/test-mode) separates test/live
  tokens and resource sets. The same API/key mechanism does not make credentials,
  environments, permissions or product entitlements interchangeable.

Approve implementation and synthetic tests now; keep actual read-token
permission and environment-specific activation unverified until probed.
No supplier process configuration was available in this runner, so no
authenticated request or credential inspection was performed. T017 is not
complete, no live readiness/configuration was changed, and the no-write-key
fallback rule is unchanged.

All design unknowns are resolved for planning. Dependency pin selection is an implementation lockfile check, and provider commercial/wire-document prerequisites are explicit fail-closed activation gates. They are not assumptions of live support. No product acceptance, migration, deployment or provider call was performed during research.
