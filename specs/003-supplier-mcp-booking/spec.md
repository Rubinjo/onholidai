# Feature Specification: Supplier MCP Search and Whole-Trip Booking

**Feature Branch**: `main` (existing branch; no branch-creation hook configured)

**Created**: 2026-10-17

**Status**: Draft — validated for planning; implementation and live-provider approval are not established by this specification.

**Updated**: 2026-10-19 - supplier setup simplified; existing implementation is not certified against this revision.

**Input**: User description: Build a first-party, read-only supplier MCP integration using Duffel for flights and accommodation and Viator for activities. Defer Booking.com and Trainline to later features, with no current rail replacement; replace GetYourGuide with Viator. Support separate Duffel read/write keys and Viator's single read/write key without giving the agent transaction authority. Preserve Tavily Search API web research, preference-based discovery, the existing trip workspace, whole-trip review and explicit authorization, including safe partial and uncertain outcomes.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Find and compare relevant offers (Priority: P1)

As a traveller, I can research transport, accommodation, and activities from my trip workspace, compare relevant options, and understand their sources, prices, eligibility, freshness, and limitations without changing my accepted trip.

**Why this priority**: Trustworthy discovery is useful independently of booking and is the basis for later recommendations and review.

**Independent Test**: Open an existing trip and search against deterministic Duffel flight/accommodation and Viator activity suppliers with no Booking.com, Trainline, or GetYourGuide access. Compare results and inspect details while checking that accepted trip history and provider inventory remain unchanged.

**Acceptance Scenarios**:

1. **Given** a trip with dates and a traveller party, **When** the traveller searches from `/trips/[tripId]`, **Then** available Duffel flight/accommodation and Viator activity offers are grouped by the trip requirement they fulfil, separately from accepted components, with provider attribution and customer-facing price and currency.
2. **Given** Duffel accommodation results with different supported property types, **When** results and details are shown, **Then** the actual property type and occupancy are preserved and unavailable facts remain unknown; no unsupported property coverage is claimed.
3. **Given** expired, estimated, and successfully live-revalidated offers, **When** they are compared, **Then** their different freshness states, check times, expiry, availability, and material terms are distinguishable in text; a live check does not imply a reservation.
4. **Given** a provider outage, missing access, unsupported market, rate limit, or timeout, **When** research finishes, **Then** successful results remain usable, each affected source has an accurate limitation or safe error, and the accepted trip remains unchanged. A successful empty search is distinguishable from a search that could not run.
5. **Given** an offer outside the current trip scope or belonging to another traveller, **When** its details or revalidation are requested, **Then** access is denied without exposing that traveller's information.
6. **Given** no Trainline access or rail replacement, **When** a search includes rail, **Then** rail is explicitly unsupported/deferred, available flight/accommodation/activity results remain usable, and no rail inventory, price, timing, or reservation is fabricated.
7. **Given** separate Duffel read/write keys and one Viator key, **When** the agent performs discovery, details or revalidation, **Then** only approved non-transactional operations execute, zero provider writes occur, and no supplier key is exposed to the agent or traveller.

---

### User Story 2 - Receive decisions that respect stated preferences (Priority: P1)

As a traveller, I receive a suitable recommendation or routine selection based on my existing trip facts, with a concise explanation of assumptions and trade-offs. I answer a chat question only when my answer can materially change the outcome.

**Why this priority**: Research should reduce planning effort while preserving traveller control and the authoritative trip rules.

**Independent Test**: Use fixed offer sets with a dominant option, equivalent options, a consequential unresolved trade-off, and a material missing fact. Verify recommendations and questions independently of provider transactions.

**Acceptance Scenarios**:

1. **Given** one offer best satisfies the recorded constraints, dates, budget, and preferences, **When** the agent compares offers, **Then** it recommends or selects that offer without asking the traveller to choose, explains the relevant fit and trade-off, and does not claim unknown facts are satisfied.
2. **Given** equivalent eligible offers, **When** preferences do not distinguish them, **Then** the agent uses a consistent tie-break and explains any material assumption without an unnecessary clarification question.
3. **Given** meaningfully different competitive options that recorded preferences cannot resolve, or a missing fact that changes eligibility or fit, **When** the agent proceeds, **Then** it asks a focused chat question explaining the consequence and does not silently resolve the material uncertainty favourably.
4. **Given** a recommended or selected offer, **When** it would change the accepted trip, **Then** the existing validated proposal, application-policy, version-check, change-summary, and history rules apply. A stale proposal cannot overwrite newer trip facts.
5. **Given** a need for destination web research, **When** the agent researches, **Then** the existing Tavily Search API integration remains the web-search capability; web content is not treated as live supplier inventory or booking evidence.
6. **Given** a trip can be planned with available flights, stays and activities but no rail data, **When** the agent researches or refines it, **Then** it completes useful planning without requiring a rail quote or Trainline credentials. If rail is explicitly required, it explains the unresolved constraint and asks a focused question only when needed; it never silently substitutes another mode or claims web research is verified rail inventory.

---

### User Story 3 - Review and authorize one complete trip (Priority: P1)

As the authenticated trip owner, I can review the complete trip and all required bookable components on `/trips/[tripId]/booking`, inspect current prices and terms, and explicitly authorize one whole-trip booking.

**Why this priority**: Consequential actions require a complete, understandable review with an exact authorization basis.

**Independent Test**: Start with a seeded eligible trip and deterministic live-revalidation outcomes. Review every component and authorize once; repeat with one missing or ineligible component and with stale terms.

**Acceptance Scenarios**:

1. **Given** a guest's existing trip, **When** the guest enters booking, **Then** the existing sign-in and trip-linking boundary preserves the plan and returns the authenticated owner to its review; no booking starts during authentication.
2. **Given** a complete eligible trip, **When** booking review opens, **Then** it shows the route, dates, traveller party, all included transport, accommodation, and activities, component-level customer prices and material terms, the exact trip total and currency, and freshness. There are no component selection controls for booking.
3. **Given** a required missing, unavailable, unsupported, unverified, expired, or non-bookable component, **When** revalidation completes, **Then** review identifies the affected requirement and what must be resolved; authorization and execution are blocked even if other components are eligible. A generic acknowledgement of unknown facts cannot make a trip eligible.
4. **Given** current complete live terms, **When** the traveller explicitly authorizes the displayed whole trip through the booking interface, **Then** one authorization binds the owner, trip version, complete component set, current provider offers and inventory, dates, travellers, exact customer total and currency, material terms, expiry, and disclosed non-reversible conditions before execution starts.
5. **Given** any material fact changes or terms expire before a pending write, **When** execution eligibility is checked, **Then** the old authorization cannot authorize that write; fresh complete review and authorization are required. Already confirmed bookings remain recorded.
6. **Given** a chat message saying “book everything,” a repeated click, a second tab, or a page reload, **When** the request is processed, **Then** chat alone cannot authorize a transaction and duplicate submissions cannot create duplicate provider actions.
7. **Given** a complete trip requiring only supported flights, accommodation and activities, **When** booking eligibility is checked without Booking.com or Trainline configuration, **Then** their absence does not block it; a genuinely required unresolved rail leg still blocks the entire attempt and is not silently waived.

---

### User Story 4 - Understand and recover from a booking attempt (Priority: P1)

As a traveller, I can see the lasting result of my one whole-trip attempt, understand which bookings are confirmed, failed, uncertain, or not attempted, and take a safe next step without losing confirmed arrangements or risking duplicates.

**Why this priority**: Suppliers do not share an atomic transaction; accurate outcomes and safe recovery are essential booking behavior.

**Independent Test**: Run deterministic attempts with partial success, timeout after provider commit, interrupted execution, contradictory evidence, and replay. Reopen the trip and verify outcomes and recovery choices.

**Acceptance Scenarios**:

1. **Given** some providers confirm while another definitively fails, **When** the attempt completes or stops, **Then** confirmations and references are preserved, all component outcomes and the overall partial result are visible, and the interface explains that one whole-trip attempt did not guarantee all-or-nothing execution.
2. **Given** a request may have committed before timing out, **When** the traveller returns or requests recovery, **Then** the component remains uncertain until a status check establishes its outcome; no blind retry occurs. If status cannot establish truth, the interface provides a manual support path.
3. **Given** a confirmed component and unresolved remaining components, **When** recovery is reviewed, **Then** confirmed bookings cannot be rebooked or silently cancelled; the review covers the entire trip, distinguishes existing commitments from the remaining amount, and offers a single continuation for all eligible unresolved components, rather than a subset checkout.
4. **Given** recovery requires a changed offer, price, traveller, or material term, **When** continuation is requested, **Then** fresh trip-wide review and explicit authorization are required before further writes. The original attempt and its outcomes remain traceable.
5. **Given** an interrupted browser session or workflow restart, **When** the owner reopens booking, **Then** durable outcomes and pending reconciliation are restored without starting another booking attempt.

---

### User Story 5 - Use the experience accessibly and trust its claims (Priority: P2)

As a traveller using a keyboard, screen reader, or small screen, I can compare offers, review the full trip, authorize, and understand recovery. As an operator, I can distinguish demonstrated behavior from unavailable provider access.

**Why this priority**: Accessible operation and truthful availability are part of correctness across every earlier story.

**Independent Test**: Complete the four journeys with keyboard-only and screen-reader operation at narrow and wide viewport sizes, then inspect the deterministic acceptance report and provider readiness declarations.

**Acceptance Scenarios**:

1. **Given** a 320-pixel-wide screen or keyboard-only input, **When** the traveller completes discovery and booking review, **Then** no essential information or action is clipped, focus order is logical and visible, and controls have accessible names.
2. **Given** an asynchronous result, changed price, blocked authorization, or uncertain outcome, **When** it appears, **Then** assistive technology can identify the state and next action without relying on colour or disruptive focus changes.
3. **Given** deterministic mode or a provider whose prerequisites are not established, **When** results or booking readiness are displayed, **Then** demonstration data is labelled and live search or booking is not claimed.

### Edge Cases

- Zero matching inventory, partial supplier availability, malformed responses, duplicate offers, delayed out-of-order search responses, and an offer removed between search and detail retrieval.
- Missing service times, timezones, cancellation policy, baggage, occupancy, accessibility evidence, age eligibility, taxes, fees, or non-reversible conditions; no favourable defaults or invented live facts.
- Child age at service date, overnight rail and flights, changed dates or traveller party, overlapping services, minimum connection and check-in requirements, and accommodations requiring multiple rooms.
- Different property types or fare classes that appear similar but carry distinct material terms; a low price cannot override a hard constraint.
- Mixed currencies, unsupported conversion, additional mandatory provider fees, unsafe monetary arithmetic, expired conversion evidence, and totals that do not equal component amounts.
- A missing required trip leg or stay that is absent from the component list; a list of eligible existing components alone does not prove whole-trip completeness.
- Credentials missing, expired, revoked, or over-scoped; commercial access or market coverage absent; read-only revalidation unsupported or implemented upstream through a hold/reservation.
- A trip edit during review or execution, authorization expiry between component writes, duplicate clicks in separate tabs, a replayed request with different terms, and a disconnected traveller returning mid-attempt.
- Provider timeout before or after commit, unsupported idempotency or status lookup, process failure after provider confirmation but before local recording, repeated or contradictory callbacks, and status checks that remain inconclusive.
- A confirmed component combined with failed, uncertain, action-required, or not-attempted components; no automatic cancellation, silent substitution, or subset checkout.
- Supplier text containing sensitive data, unsafe links, or instructions; source content cannot expand agent permissions or change booking authorization rules.
- A rail-only request or existing accepted rail component while Trainline is deferred; preserve recorded facts and confirmations, expose the limitation, and never invent a replacement or waive a required leg.
- Duffel Flights access without Stays access, or one unavailable Duffel product operation; isolate readiness so one product's missing access does not disable the other.
- Viator's shared key authorizes upstream writes but discovery must not; the key alone does not establish booking entitlement. A requested Duffel read requiring elevated permissions remains unsupported until its safety and permitted scope are established.

## Requirements _(mandatory)_

### Functional Requirements

#### Existing boundaries and access

- **FR-001**: The feature MUST extend the existing authoritative trip, normalized supply offers, ownership and guest-to-account access, proposal acceptance, pricing projections, and authorized booking workflow. It MUST NOT create a competing trip store, offer normalization policy, authorization system, or booking orchestrator. Existing saved trips and recorded transactions MUST remain readable with explicit compatibility handling for changed contracts.
- **FR-002**: Every search, detail lookup, revalidation, proposal, authorization, transaction, and status read MUST enforce the existing traveller/trip access boundary. Agent research MUST be scoped to the permitted trip, current context, and requested capability; arbitrary cross-trip identifiers or provider destinations MUST NOT bypass that scope.

#### Supplier discovery and capabilities

- **FR-003**: A first-party supplier MCP server MUST expose typed, validated search, offer-detail, and live-revalidation tools for Duffel flights and accommodation and Viator activities where each capability is established. Accommodation MUST preserve actual supported property types and occupancy rather than assume hotels only. Booking.com and Trainline integration are deferred, with no active rail replacement; GetYourGuide is replaced, not an additional active source. These deferred/replaced providers MUST NOT be required for current setup or silently used as fallbacks.
- **FR-004**: Supplier MCP tools MUST be read-only. Search, detail, recommendation, selection, and revalidation MUST NOT reserve or hold inventory, book, pay, cancel, or reschedule. No booking, payment, cancellation, or rescheduling tool or transaction credential may be available to the conversational model. A provider operation requiring a hold is not an eligible read-only revalidation capability.
- **FR-005**: Each provider MUST declare supported component/property types, search fields, detail and revalidation support, market and traveller coverage, authentication and commercial prerequisites, freshness limits, request limits, deadline behavior, and relevant limitations. Duffel flight and accommodation readiness MUST be assessed separately per operation; access to one MUST NOT imply access to the other. Restricted transaction readiness MUST additionally declare booking, idempotency, and status-reconciliation support, including Viator booking entitlement independently of key presence. Declarations MUST distinguish supported, unsupported, unknown, configured, and verified access; adapter presence alone MUST NOT imply live access.
- **FR-006**: The agent and traveller MUST receive safe, relevant capability and limitation information. Missing credentials, approval, market coverage, or required capabilities MUST produce an explicit unavailable/unknown capability result, not synthetic live success. Rail requests MUST explicitly report unsupported/deferred rail capability rather than successful empty inventory. Development doubles MUST be visibly distinguishable from live results.
- **FR-007**: Normalized offers MUST preserve stable provider and offer attribution, applicable trip requirement, actual service/property type, dates and timezone evidence, traveller eligibility and occupancy, customer price/currency and mandatory taxes/fees, availability, check/expiry times, and material service, cancellation, refund, change, baggage, accessibility, and non-reversible terms as applicable. Missing or unverified facts MUST be explicitly unknown/unverified; source facts MUST NOT be fabricated to satisfy a required field.
- **FR-008**: Offer details and revalidation MUST preserve offer provenance and return current known facts or explicit changed, unavailable, unsupported, expired, or unknown outcomes for every requested item. An unchanged live outcome MUST require affirmative current evidence. Outages and missing evidence MUST NOT be represented as confirmed unavailability or unchanged terms.
- **FR-009**: Provider reads MUST have bounded deadlines, result sizes, and retry budgets, respect rate limits and retry guidance, and isolate provider failures. The user MUST receive successful partial results and safe source-specific failure information, with a retry action where applicable. Duplicate and out-of-order results MUST NOT duplicate offers or overwrite a newer research context.
- **FR-010**: Tavily MUST remain the agent's existing Search API web-search integration. Tavily MCP replacement is out of scope. Web research MUST retain attribution and uncertainty and MUST NOT establish live supplier prices, eligibility, or booking readiness by itself.

#### Planning and workspace

- **FR-011**: Recommendations and routine selections MUST use current trip preferences, hard constraints, budget, dates, party, accepted components, and existing commitments. Ineligible offers MUST NOT be selected; unresolved required facts MUST NOT be described as satisfied. Recommendations MUST explain material assumptions, meaningful trade-offs, and any inability to meet the requested trip. Planning MUST work without rail data or credentials, using available supported modes only when consistent with accepted constraints. Required rail remains unresolved unless authoritative self-arranged/not-required evidence exists; no silent mode substitution, invented rail component, or repeated demand for unavailable Trainline access is allowed.
- **FR-012**: The agent MUST ask through chat only when a missing fact materially affects eligibility or outcome, or genuinely competitive/meaningfully distinct choices cannot be resolved using stated preferences. A dominant suitable offer or equivalent options MUST NOT generate a forced choice; equivalent ties MUST use a consistent documented tie-break. Clarification MUST NOT substitute for booking authorization.
- **FR-013**: `/trips/[tripId]` MUST support discovery, comparison, detail review, recommendations, and offer selection while keeping researched offers distinct from accepted trip components. The existing manual or automatic proposal application policy MUST govern accepted changes, including validation, current-version checks, impact presentation or change summaries, provenance, and undo where permitted. Search failure MUST preserve the current accepted trip.
- **FR-014**: Workspace and booking views MUST distinguish estimate, quote, expired information, live-revalidated terms, and confirmed bookings with text labels and relevant check/expiry times. Selecting an offer MUST NOT imply acceptance, live availability, authorization, or booking. A new current-trip version MUST make stale research and review apparent and prevent stale acceptance.

#### Complete booking review and authorization

- **FR-015**: `/trips/[tripId]/booking` MUST present a complete overview of route, dates, party, all required transport, accommodation, and activity components, existing confirmed commitments, and any missing booking requirements. Informational/free itinerary items MUST be identified as not requiring booking and MUST NOT silently replace a required paid component.
- **FR-016**: Before authorization, every required unbooked component MUST be supported for restricted booking, live-revalidated, unexpired, eligible for the actual traveller party, compatible with trip timing and hard constraints, and accompanied by established material terms and a customer price. Required missing components MUST be detected against trip requirements, not merely the existing component list. Any failed check MUST block the entire attempt and explain its resolution. Missing deferred providers MUST NOT block a trip that has no requirement for them; a required unresolved rail leg still blocks booking and MUST NOT be silently omitted.
- **FR-017**: Review MUST show meaningful component names, provider attribution, service dates/times, travellers/occupancy, mandatory taxes and fees, exact payable prices and currency, booking/cancellation/refund/change terms, non-reversible conditions, and validity. It MUST show differences from accepted estimates. The trip total MUST equal the included customer amounts without double-counting taxes or fees; unknown mandatory costs or unsupported currency conversion MUST block authorization.
- **FR-018**: Booking MUST offer one explicit whole-trip authorization action after complete review, without controls or requests that book only a selected subset. Binding MUST include traveller identity, current trip version, complete component/provider/offer/inventory identities, dates and party, exact total/currency, material terms, expiry, and explicit acknowledgement of non-reversible conditions. Chat, draft approval, itinerary finalization, and generic acknowledgements MUST NOT constitute authorization.
- **FR-019**: A material change in the bound facts or expiry MUST invalidate unused authorization and stop subsequent writes under it until fresh complete review and authorization. This check MUST apply before every component write. Status-only updates from the same attempt MUST preserve the immutable execution basis without treating unrelated material edits as status updates.
- **FR-020**: Whole-trip completeness and authorization MUST be enforced by the authorized service boundary as well as the interface. Tampered subset requests, stale totals, mismatched owners, expired offers, and replay with altered facts MUST be rejected before a provider write. Repeated requests under the same valid authorization MUST return the same durable attempt.

#### Execution and recovery

- **FR-021**: Supplier transactions MUST remain separate from the discovery MCP server and callable only through the existing authorized booking workflow with restricted server-side credentials. The workflow MUST record durable attempt and component outcomes, immutable authorization evidence, operation identity, and duplicate-prevention evidence before consequential actions.
- **FR-022**: Each component write MUST use stable idempotency/duplicate-prevention identity bound to its authorized request. Concurrent requests, worker replay, browser refresh, or restart MUST NOT repeat a completed or possibly committed action. An adapter without safe provider idempotency MUST permit at most one unresolved write and require reconciliation or manual resolution before further action.
- **FR-023**: Provider outcomes MUST distinguish confirmed with evidence, definitively failed, uncertain, action required, and not attempted. Confirmed bookings MUST survive another component's failure. A timeout or malformed response after a possible write MUST remain uncertain; uncertain or changed execution evidence MUST stop further writes until resolved or freshly authorized as applicable.
- **FR-024**: Uncertain writes MUST be reconciled through authenticated status evidence before any retry. Missing status capability, contradictory evidence, or continued uncertainty MUST retain uncertainty and provide manual recovery. Retry MUST require definitive evidence that the previous action did not commit, currently eligible terms and authorization, and safe duplicate prevention; a new key alone MUST NOT justify retrying.
- **FR-025**: Recovery MUST keep one whole-trip attempt visible with its component-level results and history. The traveller MUST be able to check status, return to planning to resolve missing/changed options, obtain help, and review a whole-trip continuation when all unresolved requirements are eligible. Continuation MUST preserve confirmed commitments, exclude them from new writes and new payable totals, show the complete trip and remaining amount, and require fresh explicit trip-wide authorization. Arbitrary subset booking MUST remain unavailable.
- **FR-026**: Existing authorized cancellation or rescheduling boundaries MAY provide explicit recovery options where supported, but MUST require their own exact-term authorization and MUST NOT be exposed through MCP or performed automatically as compensation. The interface MUST disclose before authorization that suppliers may partially succeed and one whole-trip action is not an all-or-nothing guarantee.

#### Privacy, operations, and accessibility

- **FR-027**: Supplier credentials MUST be scoped to the minimum available upstream permissions and stored only in trusted server boundaries; no supplier credential may reach the conversational agent, MCP facade, or browser. Duffel MUST use separate read and write keys, with the read key in trusted discovery clients and the write key only in the restricted booking worker. Viator's single upstream read/write key MAY be provisioned to both trusted web-read and worker boundaries; distinct secret names MUST NOT be represented as distinct upstream scopes. The trusted Viator read client MUST enforce a closed allowlist of established side-effect-free operations and MUST NOT invoke transactional operations or expose arbitrary forwarding, even when its key permits writes. Only the explicitly authorized workflow may invoke those writes. Missing, expired, revoked, or insufficient credentials MUST fail safely without revealing secrets or implying successful access; read access alone MUST NOT establish booking entitlement.
- **FR-028**: Agent and browser responses MUST use the existing customer-safe projections. Supplier costs, platform margin, credentials, payment details, and sensitive traveller data MUST NOT reach the agent, browser, logs, or general telemetry. Research MUST use only necessary non-sensitive party/eligibility facts; required sensitive booking data MUST flow through trusted server-side handling or opaque references. Supplier payloads and error text MUST be validated and filtered rather than forwarded unrestricted.
- **FR-029**: Audit evidence MUST correlate research, proposals, authorization, attempt, component writes, status evidence, and recovery using safe identifiers, timestamps, actor, version, decision, and outcome categories. It MUST support establishing what was authorized and whether a consequential action may have happened without exposing protected data in ordinary logs. Existing retention/access rules MUST apply to restricted evidence; safe errors MUST identify an actionable next step without raw provider payloads.
- **FR-030**: Search, comparison, booking review, authorization, outcome, and recovery MUST support keyboard operation, visible focus, logical reading/focus order, accessible labels, screen-reader status/error announcements, and sufficient contrast. At widths from 320 pixels upward, essential information and actions MUST remain usable without clipped content or page-level horizontal scrolling.
- **FR-031**: Development and acceptance MUST use deterministic doubles for every in-scope provider/product and capability, including supported accommodation property-type variation and explicit unsupported rail outcomes. Coverage MUST include valid results, dominant/equivalent/competitive recommendations, unknown facts, failed prerequisites, rate limits, deadlines, changed/expired terms, subset tampering, duplicates/concurrency, partial success, timeout-after-commit, unsupported status/idempotency, contradictory callbacks, and restart recovery. Regressions MUST prove useful planning and eligible non-rail booking without deferred provider access, independent Duffel flight/stay readiness, and zero discovery writes despite Viator's shared key. Reports MUST separate implemented and tested behavior from live-provider prerequisites and commercial approvals; synthetic acceptance MUST NOT count as proof of live access.

### Key Entities _(include if feature involves data)_

- **Authoritative Trip and Version**: Existing accepted plan, requirements, party, dates, budget, constraints, components, lifecycle, history, and proposal application policy. Research never constitutes a second authoritative trip.
- **Provider Capability and Readiness Declaration**: Provider/product/operation-specific support, coverage, prerequisites, limitations, evidence of verified access, mode, and freshness expectations; read and transaction readiness are distinct. Duffel Flights and Stays are independently assessed, and Viator's shared key never establishes booking entitlement by itself.
- **Research Context and Offer**: Trip/version-scoped query and normalized attributed option with comparable requirement identity, customer-safe facts, uncertainty, eligibility, availability, and expiry; distinct from an accepted component.
- **Recommendation or Change Proposal**: Selected options, preference rationale, assumptions/trade-offs, material unresolved question if any, base version, and existing validated application/history evidence.
- **Live Revalidation Result**: Evidence-backed current terms or explicit changed/unavailable/unknown/unsupported outcome for each requested offer or required component, with check and expiry information.
- **Whole-Trip Review and Authorization**: Complete eligible trip basis and exact customer terms explicitly approved by the authenticated owner, with validity, non-reversible acknowledgements, invalidation, and immutable binding.
- **Booking Attempt and Component Outcome**: One user-facing whole-trip operation with durable per-component write identity, evidence, status, confirmed references, safe reasons, and not-attempted work.
- **Recovery Review and Audit Evidence**: Reconciled status, preserved commitments, unresolved requirements, remaining payable amount, fresh continuation authorization where needed, and a traceable relationship to the original attempt.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In controlled acceptance with responsive deterministic suppliers, at least 95% of searches display usable results within 10 seconds; all searches display results or an actionable bounded failure within 12 seconds. Failure cases preserve the accepted trip in 100% of runs.
- **SC-002**: At least 9 of 10 representative travellers can compare two offers and correctly identify provider, customer price/currency, estimated versus live status, and unknown material facts within 2 minutes without assistance.
- **SC-003**: Across a fixed set of at least 20 planning cases spanning flight, accommodation and activity discovery plus unavailable-rail cases, 100% of dominant/equivalent cases produce a suitable recommendation or selection without unnecessary clarification; 100% of material unresolved-fact or competitive-choice cases ask a relevant focused question. No recommendation claims an unknown hard requirement is satisfied. All supported non-rail cases proceed without rail data; all required-rail cases explain the unresolved constraint without fabricated inventory or silent substitution.
- **SC-004**: At least 9 of 10 representative travellers with complete eligible trips can review all components and explicitly authorize the whole trip within 3 minutes of receiving current terms, excluding time spent resolving missing traveller facts or external authentication challenges.
- **SC-005**: In all acceptance cases with missing required components, unknown material costs/terms, unsupported booking, stale offers, changed authorization facts, tampered subsets, or chat-only consent, zero unauthorized provider writes occur.
- **SC-006**: Across at least 100 deterministic duplicate, concurrent, refresh, restart, and timeout-after-commit cases, no component is booked twice; confirmed bookings remain visible and uncertain outcomes are never labelled failed or confirmed without evidence.
- **SC-007**: At least 9 of 10 representative travellers shown partial and uncertain outcomes correctly identify what is confirmed, what remains unresolved, whether further charges may have occurred, and the safe next action within 1 minute. All recovery cases preserve confirmed commitments and present no subset checkout.
- **SC-008**: Every primary journey is completable using keyboard-only and screen-reader operation at narrow and wide layouts, with zero critical or serious accessibility findings in the reviewed journeys and no essential content clipped at 320-pixel width.
- **SC-009**: In all controlled data-exposure acceptance cases, protected supplier economics, secrets, payment details, and sensitive traveller data are absent from agent/browser outputs and ordinary logs/telemetry; every consequential attempt remains traceable through restricted safe audit evidence.
- **SC-010**: For Duffel flight, Duffel accommodation and Viator activity operations separately, acceptance records explicitly identify demonstrated capabilities, current mode, unverified prerequisites, and external approvals still required. Zero demonstrations or unsupported capabilities are presented to travellers as verified live access. All absent/deferred-provider cases preserve supported results; zero discovery calls cause transactions even with a write-capable shared key.

## Assumptions

- Scope is specification of one coherent feature; this artifact does not implement integrations, establish provider accounts, procure inventory rights, or certify live behavior.
- Repository inspection found existing authoritative trip/proposal/version boundaries in `web/domain/trip`, customer-safe projections in `web/domain/pricing`, normalized offers and provider read adapters in `web/server/supply`, and the supply contract in `contracts/supply`. These are extension points, not evidence of complete provider implementations.
- Existing reads support search through injected clients; provider factory names alone do not prove commercial connectivity, detail lookup, or live revalidation. Offer detail and discovery revalidation are capabilities to establish without introducing another normalization boundary. Existing Booking.com (`booking.com`/`booking`), Trainline and GetYourGuide saved provenance and confirmed transactions remain readable and reconcilable where existing approved capabilities permit; they MUST NOT be relabelled as Duffel/Viator or newly activated merely for compatibility.
- The existing `/trips/[tripId]` workspace and booking route, `BookingReview`, `BookingConsole`, exact-term authorization, durable component workflow, and recovery/status boundaries provide starting behavior. Current review presentation and capability declarations do not establish that every requirement here is already met.
- Existing proposals permit manual or validated automatic application depending on the run's application policy. Routine agent decisions preserve that policy and its history rules; no additional approval is required merely to choose among equivalent research options.
- Whole-trip means every booking requirement of the accepted plan, including required travel legs, stays, and paid activities. Optional ideas outside the accepted plan do not block booking; confirmed commitments and clearly identified free/informational items remain visible without new writes. A required unsupported transfer or other required service blocks completeness until resolved, rather than being silently omitted.
- Whole-trip continuation after partial failure is recovery of all unresolved required work, with a full-trip review and fresh authorization, not a new component-selection purchasing flow. No new general cancellation/rescheduling product is in scope.
- A single exact customer payable currency is required for authorization, consistent with existing booking terms. Unsupported mixed-currency pricing blocks booking; unverified exchange rates or supplier economics cannot be invented to complete a total.
- Provider credentials, permitted authentication, commercial approval, geographic coverage, actual rate limits, and verified operation semantics are external dependencies to establish per deployment. Until established, live capability remains unknown/unavailable; deterministic evidence remains sufficient only for development acceptance.
- Current provider scope is Duffel Flights, Duffel Stays and Viator activities. Duffel Stays access is a separate activation prerequisite; Duffel flight access alone does not prove accommodation access. Viator's shared key does not prove booking-tier approval. No extra provider onboarding is part of current setup.
- Booking.com accommodation and Trainline rail are future additions, not implementation or release gates for this revision. No rail replacement, rail scraping, or consumer-site automation is requested. Existing rail facts remain usable as recorded evidence, not newly verified inventory.
- Existing project privacy and retention policies apply. Synthetic traveller data is used for acceptance. Required booking identity/payment prerequisites must be satisfied through trusted handling before the complete review is eligible; this feature does not expose new sensitive-data collection to the conversational model or application browser.
- User-task success percentages require a representative 10-person usability evaluation; deterministic timing and safety outcomes are measured separately from external provider service levels. Passing this specification's quality checklist means readiness for planning, not that those evaluations have already occurred.
