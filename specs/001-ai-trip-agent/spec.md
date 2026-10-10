# Feature Specification: AI Trip Planning Agent

**Feature Branch**: `main` (no branch hook configured)

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Build a conversational AI travel agent that helps users discover, plan, optimize, and eventually book a complete holiday through a visual trip builder and a continuously refining agent."

## Clarifications

### Session 2026-10-10

The user directed adoption of the analysis recommendations; the following five bundled decisions were accepted without additional questions.

- Q: How should departure origin and initial estimate acceptance work? → A: Require a traveller-confirmed departure city or airport, default return to that origin, and present initial estimates as typed draft proposals that require explicit review and acceptance.
- Q: How should authorization survive a booking's own status updates? → A: Bind execution to immutable approved terms and the starting version; allow only proven status/evidence updates from that transaction, while material term changes stop remaining writes and require fresh authorization.
- Q: Which capabilities must pass each delivery checkpoint? → A: Setup proves service shells only, foundations add durable storage, US1 proves setup and accepted estimate reload, US2 adds conversation/history and pane convergence, US3 adds finalization, and US4 adds booking; later capabilities are not earlier acceptance prerequisites.
- Q: How should agent progress and results survive interrupted delivery? → A: Persist scoped, redacted run events and results before acknowledging or displaying them; exact retries return the same receipt, conflicting reuse is rejected, cursor gaps do not partially commit, and interrupted runs become visibly retryable without changing the trip.
- Q: How should feasibility and percentage targets be judged reproducibly? → A: Use the stated timing/rest policy, frozen representative synthetic cases with predetermined outcomes, and a fixed 20-person usability protocol; record denominators, failures, versioned inputs and scoring before user-story implementation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build an Initial Trip Estimate (Priority: P1)

As a traveller, I want to describe where, when, how long, and with whom I want to travel, together with my style and special requirements, so that I receive a realistic starting plan and estimated cost without researching every component myself.

**Why this priority**: This journey establishes the authoritative trip state and delivers the first useful outcome on which all refinement and booking depend.

**Independent Test**: A traveller can configure departure origin and a multi-destination trip, submit it, review an estimated route, duration allocation, cost range, and constraint summary, and explicitly accept the proposal. This increment requires setup controls, progress/clarification, estimate review, an accessible route preview, and reload of the accepted snapshot; the full conversation workspace and history are tested in User Story 2.

**Acceptance Scenarios**:

1. **Given** a traveller is starting a trip, **When** they confirm a departure city or airport and search or use the map to add multiple countries and cities, **Then** the origin and selected destinations are shown geographically and can be changed before submission; the return defaults to the confirmed origin.
2. **Given** the traveller has one or more availability windows, **When** they mark preferred and flexible dates and set minimum, ideal, and maximum duration, **Then** the setup preserves each distinction and prevents duration values outside the available windows.
3. **Given** the traveller specifies adults, children and their ages, five travel-style preferences, and free-text requirements, **When** they request an estimate, **Then** the estimate accounts for those inputs and identifies any material conflict or unresolved constraint.
4. **Given** the traveller permits date flexibility, **When** a cheaper valid date combination is found, **Then** the estimate presents it as an alternative without replacing the preferred dates automatically.
5. **Given** an estimate is available, **When** the traveller reviews it, **Then** they see a proposed destination route, approximate travel times and costs, accommodation and activity costs, total estimated cost, style compatibility, and material itinerary constraints, all clearly labelled as estimates; submission alone does not accept the proposal, and only explicit acceptance records the estimated plan as a new trip version.

---

### User Story 2 - Refine the Living Trip (Priority: P1)

As a traveller, I want to discuss my trip with an agent and edit core details directly, so that every accepted change updates one coherent plan, map, itinerary, and price while I remain in control.

**Why this priority**: Continuous, explainable refinement is the defining value of the product and must work before detailed fulfilment or booking can be trusted.

**Independent Test**: Starting from an accepted estimate, a traveller can request a natural-language change, review its impact, accept it, see all affected views update consistently, and reverse the change. Reload restores both the authoritative snapshot and redacted conversation/history; all workspace panes show the same committed version.

**Acceptance Scenarios**:

1. **Given** an estimated trip, **When** the planning workspace opens, **Then** the traveller sees editable trip details on the left, the geographic itinerary in the centre, the agent conversation on the right, and the current total with a booking action in a persistent bottom area.
2. **Given** the traveller asks to add two nights in a destination, **When** the agent interprets the request, **Then** it presents the proposed duration, route, transport, accommodation, activity, and price impacts before applying them to the trip.
3. **Given** a requested change is unambiguous and non-transactional, **When** the traveller accepts it, **Then** the structured trip, map, schedule, availability status, and estimated price reflect the same updated version.
4. **Given** a request has materially different reasonable interpretations, **When** choosing one would meaningfully affect scope, price, accessibility, or experience, **Then** the agent asks one focused clarification question rather than changing the trip.
5. **Given** the traveller edits dates, duration, destinations, travellers, or preferences in the trip pane, **When** the edit is accepted, **Then** the agent explains affected recommendations and recalculated components without restarting the planning process.
6. **Given** an accepted draft change, **When** the traveller chooses to undo it, **Then** the prior trip version is restored and all planning views return to that version without booking or payment side effects.

---

### User Story 3 - Finalize a Complete Itinerary (Priority: P2)

As a traveller, I want a complete and practical day-by-day holiday plan, so that I can understand the exact travel experience and decide whether it is ready to book.

**Why this priority**: A detailed, feasible itinerary turns recommendations into a decision-ready holiday while remaining useful before transactional booking is available.

**Independent Test**: A traveller can finalize a draft containing complete flight, stay, activity, daily schedule, direction, timing, condition, and total-price information, with conflicts visibly resolved or disclosed.

**Acceptance Scenarios**:

1. **Given** a refined draft trip, **When** the traveller requests a final itinerary, **Then** it includes outbound and return flight details, each accommodation stay, each booked-or-proposed activity, daily morning/afternoon/evening plans, free time, and relevant practical notes.
2. **Given** an itinerary includes travel between places, **When** it is finalized, **Then** each relevant segment provides an appropriate walking, public transport, driving, transfer, or intercity option with expected duration and recommended departure time.
3. **Given** the traveller has constraints such as no early mornings, accessibility needs, dietary needs, or limits on hotel changes, **When** the itinerary is finalized, **Then** every scheduled component is checked against those constraints and any unavoidable exception is prominently explained.
4. **Given** a proposed day would be unrealistically dense, **When** the schedule is evaluated, **Then** the agent preserves realistic transit, rest, and free-time allowances and suggests which lower-priority item to remove or move.

---

### User Story 4 - Book the Authorized Trip (Priority: P3)

As a traveller, I want to review live terms and explicitly authorize my holiday booking, so that the platform can reserve components reliably and tell me exactly what succeeded, failed, or needs attention.

**Why this priority**: Booking creates external and financial consequences, so it follows a useful planning experience and requires stronger safeguards than draft refinement.

**Independent Test**: A traveller can proceed from a finalized draft through live revalidation, exact-term confirmation, component booking, partial-failure handling, and receipt of a confirmed itinerary without any estimate being represented as confirmed prematurely.

**Acceptance Scenarios**:

1. **Given** a traveller selects the booking action, **When** the booking workflow begins, **Then** current price and availability are rechecked and a final summary distinguishes confirmed-live terms from changed, unavailable, and still-estimated components.
2. **Given** current terms are ready, **When** the traveller reviews the exact components, total price, material conditions, and non-reversible actions, **Then** no reservation or payment occurs until the traveller explicitly confirms those terms.
3. **Given** price, dates, travellers, inventory, or cancellation terms change after confirmation, **When** execution has not completed, **Then** prior authorization is invalidated and renewed confirmation is required.
4. **Given** one or more components fail during booking, **When** other components have succeeded, **Then** duplicate reservations are prevented, each component status is shown, recoverable options are offered, and successful confirmations remain available.
5. **Given** all intended components complete successfully, **When** booking finishes, **Then** the traveller receives confirmations and the final itinerary is updated with confirmed references, terms, and statuses.

---

### Edge Cases

- A date window is shorter than the requested minimum duration, or multiple windows cannot accommodate the trip.
- The ideal duration conflicts with transport schedules, destination count, budget, or realistic transit time.
- A city appears in multiple countries or map search results are ambiguous.
- Child ages change pricing, room occupancy, activity eligibility, or required travel conditions.
- Free-text requirements conflict with slider preferences or with one another.
- Accessibility, dietary, or mobility requirements cannot be verified for a proposed component.
- A destination is seasonal, unsafe, closed, or impractical during the selected dates.
- A request to reduce price cannot preserve all existing destinations or non-negotiable constraints.
- Availability or price changes while the traveller is reviewing or authorizing the trip.
- A conversational request appears to authorize booking, payment, cancellation, or another consequential action.
- A provider returns delayed, contradictory, duplicate, or incomplete outcomes during booking.
- One booking confirmation advances the displayed trip version before the next component starts; transaction-owned status-only changes remain eligible, while an external edit or changed confirmed terms require renewed authorization.
- The map is unavailable or cannot be operated visually, while trip creation and refinement must remain possible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let travellers search for and select one or more countries and cities using both a geographic map and an equivalent non-map control. Flight estimation requires a traveller-confirmed departure city or airport with country identity and timezone; missing or ambiguous origin requires focused clarification rather than inference from location or identity. The return defaults to that origin, and changing it recalculates affected transport, dates, stays, schedules and prices.
- **FR-002**: Travellers MUST be able to add, remove, reorder, or replace destinations throughout draft planning without recreating the trip.
- **FR-003**: The system MUST accept one or more travel availability windows and preserve which dates are preferred versus flexible.
- **FR-004**: The system MUST let travellers set minimum, ideal, and maximum trip duration, constrain those values to valid availability, and prefer the ideal unless a shorter or longer option provides a material stated benefit.
- **FR-005**: The system MUST let travellers specify and later change adult count, child count, and each child's age, and MUST recalculate every affected trip component after a change.
- **FR-006**: The system MUST capture preferences on relaxed/packed, budget/luxury, touristy/authentic, independent/organized, and cities/nature ranges.
- **FR-007**: The system MUST accept free-form requirements and preserve interpreted constraints in a form the traveller can review, correct, prioritize, or remove.
- **FR-008**: The system MUST produce an initial estimate containing a proposed route, destination durations, travel times, transport, accommodation, activities, total cost, style compatibility, and material constraints where information is available. It MUST be an explicit validated draft proposal bound to the initiating request and current trip version. Requesting an estimate authorizes research only; the traveller reviews and explicitly accepts it before its operations, recalculated price and rationale are stored as a new reversible trip version. Stale proposals are rejected without partial application.
- **FR-009**: Every price or availability value that has not been revalidated for booking MUST be visibly identified as estimated and MUST NOT be described as confirmed.
- **FR-010**: From User Story 2 onward, the planning workspace MUST persistently present editable trip state, a geographic itinerary, the agent conversation, and the current total price with a booking action. User Story 1 has a separate setup/estimate acceptance gate; full conversation/history and pane convergence are not prerequisites for its completion. Booking remains visibly unavailable until User Story 4 passes.
- **FR-011**: The trip summary MUST display destinations, dates, duration, travellers, relevant preferences, constraints, and current estimated or revalidated total.
- **FR-012**: The geographic view MUST show selected countries, itinerary destinations, route order, relevant travel segments, and useful booked-or-proposed places, and MUST update to the current trip version.
- **FR-013**: The agent MUST ask only for missing information that materially affects scope, price, accessibility, feasibility, or traveller experience, and otherwise use reviewable assumptions.
- **FR-014**: The agent MUST explain the reasons, trade-offs, and expected impact when recommending or changing destinations, durations, routes, stays, activities, schedules, or costs.
- **FR-015**: A natural-language request MUST be translated into an explicit, validated change to the authoritative structured trip rather than stored only as conversation text.
- **FR-016**: Before accepting a draft change, the system MUST identify affected dates, durations, transport, stays, activities, availability, route, constraints, and price, and MUST show material impacts to the traveller.
- **FR-017**: Each accepted draft change MUST create an inspectable trip version that records the initiating request and can be reversed unless a disclosed domain rule makes reversal impossible.
- **FR-018**: Direct edits and accepted conversational changes MUST update the same authoritative trip version across the summary, map, itinerary, availability, and pricing views.
- **FR-019**: Draft planning changes MUST NOT reserve inventory, charge the traveller, or trigger any other booking side effect.
- **FR-020**: The system MUST detect conflicts among dates, durations, route timing, traveller eligibility, preferences, accessibility needs, stated constraints, and availability, and MUST explain unresolved conflicts before finalization. Apply the feasibility policy below; known hard conflicts block finalization, missing verification is disclosed and cannot receive a verified pass, and lower-priority items are proposed for removal or movement without silently discarding required constraints.
- **FR-021**: A final itinerary MUST include flight times, airports, airlines, duration, layovers, prices, baggage details where available, and relevant fare conditions.
- **FR-022**: A final itinerary MUST include each property's location, stay dates, accommodation type, guest count, price, cancellation conditions, relevant amenities, and travel time to important itinerary items.
- **FR-023**: A final itinerary MUST include each activity's name, date, time, duration, location, price, booking requirements, and directions where applicable.
- **FR-024**: A final itinerary MUST provide a realistic morning, afternoon, and evening schedule with travel, estimated travel time, recommended departure times, free time, food recommendations where relevant, and practical notes.
- **FR-025**: Relevant itinerary segments MUST provide appropriate walking, public transport, driving, airport transfer, or intercity guidance with approximate duration and recommended departure time.
- **FR-026**: In internal diagnostic use, authorized team members MUST be able to inspect component supplier costs, platform margin, final customer prices, and calculation totals for testing and audit purposes.
- **FR-027**: In the production customer experience, travellers MUST see the final total and required taxes, fees, and disclosures, while supplier costs and platform margin remain hidden.
- **FR-028**: The system MUST retain supplier cost, margin, required taxes and fees, and final customer price as distinct pricing facts even when only the final total is customer-visible.
- **FR-029**: Selecting the booking action MUST enter a distinct transactional workflow that rechecks live price and availability before presenting a final booking summary.
- **FR-030**: The system MUST require explicit traveller authorization for the exact current components, travellers, dates, total price, material terms, and disclosed non-reversible actions before reservation or payment. Execution retains an immutable approved version and terms basis; the current version MUST match at execution start and before the first provider write. Every pending write MUST recheck identity, terms, expiry and authorization validity. Only status, lifecycle and confirmation evidence updates from the same transaction may advance the displayed version without changing that basis.
- **FR-031**: A material change to price, dates, travellers, origin, inventory, components, or cancellation terms MUST invalidate prior authorization and require renewed confirmation before any remaining write. A confirmation containing changed material facts is also a material change. Successful confirmations remain available. Concurrent material edits and provider-write dispatch MUST be serialized: an edit cannot be accepted while an affected write has an unresolved outcome, and a pending write cannot start under invalidated terms.
- **FR-032**: The booking workflow MUST prevent duplicate consequential actions, record durable outcomes, and track each component as proposed, authorized, committed, failed, or cancelled as applicable.
- **FR-033**: Travellers MUST be able to reschedule an eligible individual component through the transactional workflow without implying that unaffected components were changed.
- **FR-034**: When a booking partially fails, the system MUST preserve and display successful confirmations, identify failed or uncertain components, and present recovery or cancellation options without retrying blindly.
- **FR-035**: Confirmed booking details and statuses MUST update the final itinerary and remain distinguishable from unconfirmed components.
- **FR-036**: Sensitive payment and traveller data MUST be limited to what is needed for the current action and MUST NOT appear in agent conversation history, general activity logs, or non-production examples.
- **FR-037**: Every interactive planning and booking action MUST be operable by keyboard, expose a logical focus order and understandable labels, support assistive technologies, and not rely on colour or the map alone to convey state.
- **FR-038**: When the map or a third-party travel source is unavailable, the system MUST preserve the traveller's current trip and provide a clear non-map or retry path rather than silently losing changes. Agent progress, clarification, proposals and final results MUST be persisted under authorized run/trip scope before acknowledgement or display; exact replay returns the original receipt, conflicting reuse and cursor gaps fail without partial commitment. Reconnect reloads recorded events/results; a process-interrupted run becomes visibly failed with a retry option, and research retries never apply a draft or reserve inventory without the separate acceptance or authorization.

### Key Entities *(include if feature involves data)*

- **Trip**: The authoritative holiday plan, including its current lifecycle state, departure origin, destinations, availability, duration targets, travellers, preferences, constraints, itinerary, pricing, and booking status.
- **Departure Origin**: A traveller-confirmed city or airport, with country identity, timezone and optional airport code; the default return location and an editable authoritative transport fact.
- **Trip Version**: An inspectable snapshot of a draft trip resulting from a direct edit or accepted agent proposal, including its initiating request, material impacts, and reversal relationship.
- **Destination**: A selected country, city, or place with route order, planned dates, duration, and geographic identity.
- **Availability Window**: A period in which travel is possible, including preferred versus flexible dates.
- **Traveller Party**: Adult and child travellers, child ages, and only the eligibility or accessibility facts needed to plan and book suitable components.
- **Travel Preferences and Constraints**: Structured slider positions and interpreted free-text needs, each with priority, provenance, and traveller-confirmed corrections.
- **Itinerary Day**: A dated morning, afternoon, and evening plan containing activities, free time, meals, practical notes, and travel segments.
- **Travel Component**: A flight, accommodation stay, activity, transfer, or intercity segment with proposal, availability, pricing, terms, and booking status.
- **Price**: Supplier amount, platform margin, required taxes and fees, final customer amount, currency, estimate or live status, and time last checked.
- **Change Proposal**: The agent's explicit interpretation of a requested trip change, its affected facts, trade-offs, and acceptance status.
- **Booking Transaction**: The separately authorized attempt to reserve one or more exact travel components, with an immutable execution basis identifying the approved version and terms, attributable status-only version advances, component outcomes, duplicate-prevention identity, and confirmation records.
- **Booking Confirmation**: Provider-confirmed evidence for a committed component, including reference, final terms, status, and traveller-facing instructions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of usability-test participants can create and submit a valid multi-destination trip estimate in 8 minutes or less without assistance.
- **SC-002**: At least 95% of valid trip setups produce a reviewable initial estimate proposal within 30 seconds, measured from accepted estimate request to proposal visibility and excluding only time waiting for traveller clarification; traveller review and acceptance time are outside this latency measurement.
- **SC-003**: At least 90% of evaluated estimates visibly account for every traveller-marked non-negotiable constraint or clearly identify why one cannot be met.
- **SC-004**: At least 95% of common unambiguous change requests result in a correct proposed trip change without an unnecessary clarification question.
- **SC-005**: For 100% of accepted draft changes in regression scenarios, the summary, map, itinerary, availability, and displayed total refer to the same trip version.
- **SC-006**: At least 90% of usability-test participants can understand the reason and price impact of an agent recommendation without additional explanation.
- **SC-007**: In itinerary feasibility review, at least 95% of scheduled items pass the feasibility policy below, and 100% of known hard conflicts are disclosed and prevent finalization. Unverified transport durations or missing timing evidence count as failures for the 95% calculation.
- **SC-008**: At least 90% of travellers rating a finalized itinerary describe its pace and destination mix as consistent with their stated preferences.
- **SC-009**: In 100% of customer-facing production pricing checks, supplier cost and platform margin are absent while the final total and required disclosures remain visible.
- **SC-010**: In 100% of booking tests, no reservation or payment occurs without explicit authorization bound to the current material terms.
- **SC-011**: In 100% of duplicate and partial-failure booking tests, no component is booked twice and every attempted component ends with a visible confirmed, failed, cancelled, or action-required outcome.
- **SC-012**: All core setup, refinement, finalization, and booking journeys can be completed using only a keyboard and a screen reader, with no information available exclusively through colour or map interaction.

**Feasibility policy (version 1)**: Evaluate timezone-qualified times as elapsed instants; invalid or ambiguous local times require clarification. Between different locations allow the sourced upper travel-duration bound (or sourced single duration) plus 15 minutes transition; unknown duration is unverified. Arrive at rail/ferry departures at least 30 minutes early and airport departures at least 120 minutes for domestic or 180 minutes for international flights, using a greater provider requirement when available. Connections require the provider's published minimum plus 30 minutes; a missing minimum is unverified. These are planning defaults, not representations of carrier requirements. On ordinary leisure days preserve at least 9 hours overnight rest, two 45-minute meal blocks and 60 minutes free time, with discretionary activities limited to 4 hours for pace 0–33, 6 hours for pace 34–66 and 8 hours for pace 67–100, and total occupied activity/meal/travel time capped at 10 hours. Mandatory long-distance travel may exceed daily pace/rest defaults only as a prominently disclosed exception; it never waives impossible connections or traveller-required constraints. Recommend moving/removing lower-priority items when limits are exceeded.

**Evaluation protocol (version 1)**: Before user-story implementation, freeze inputs and expected outcomes for 100 valid estimate cases (at least 10 each exercising origin, date flexibility, party eligibility, style and required constraints; categories may overlap), 100 unambiguous refinement requests (20 each for destinations, dates/duration, travellers, preferences and constraints), at least 20 separate materially ambiguous requests, and at least 100 itinerary days containing 500 scheduled items plus at least 20 known-hard-conflict cases. Record corpus identity, policy version, seed, commands, provider/model configuration, failures and denominators; revisions require a documented reason and a fresh complete evaluation. SC-002 requires at least 95/100 proposals within its time limit, SC-003 at least 90/100 cases accounting for every required constraint or explaining failure, SC-004 at least 95/100 requests matching the predetermined validated operations without unnecessary clarification, and SC-007 at least 475/500 items passing the policy plus every hard-conflict case blocked. Extra cases keep the same percentage thresholds. Deterministic provider evidence is reported separately from live-provider performance.

**Usability protocol (version 1)**: Use the same fixed cohort of at least 20 leisure travellers, including at least 5 who use keyboard-only or screen-reader interaction. Include at least 5 family-trip planners and 5 multi-destination planners; groups may overlap. Give identical task briefs without assistance and include failures in denominators. SC-001 passes when at least 18/20 submit valid setup within eight minutes from opening setup (estimate generation/review time excluded). SC-006 passes when at least 18/20 correctly identify both the stated recommendation reason and the direction/amount/currency of its price impact. SC-008 passes when at least 18/20 rate both pace and destination mix at least 4 out of 5 against their recorded preferences. Larger cohorts use the same 90% threshold; record the cohort, task briefs, scoring and anonymized results. Accessibility checks remain mandatory for every core journey regardless of cohort percentages.

## Assumptions

- Travellers may explore and refine estimates before entering payment details; identity and account policy will follow the platform's standard customer access rules.
- Delivery checkpoints enable only completed capabilities: initial service shells need no migration or booking execution; durable storage precedes US1, the full workspace follows in US2, finalization in US3 and transactional booking in US4. Earlier checks must not depend on later increments.
- The platform serves leisure trips and displays monetary values in a clearly identified currency; currency conversion and exchange-rate disclosures follow standard commercial practice.
- Recommendations may rely on incomplete or time-sensitive travel information, so source freshness and estimate status are disclosed whenever they affect a decision.
- Date optimization searches only within traveller-provided flexible windows and never silently changes preferred dates.
- The ideal duration is the default optimization target; deviations require a material improvement in price, feasibility, route efficiency, or experience and a clear explanation.
- Free-text interpretations remain editable planning facts rather than irrevocable assumptions.
- Food recommendations need not be directly bookable unless represented as a bookable activity or reservation component.
- Visa, passport, insurance, health, and destination-entry guidance may be surfaced as practical notes, but the traveller remains responsible for verifying official requirements unless a separately scoped service assumes that responsibility.
- Live inventory, reservation, payment, cancellation, and rescheduling depend on external travel providers capable of returning current terms and durable outcomes.
- Legal and commercial disclosures vary by market and are supplied by the responsible business policy for the traveller's jurisdiction.
- Internal diagnostic pricing is restricted to authorized team members and is never a customer-selectable display mode in production.
- Booking may be delivered incrementally by component, but no component is represented as confirmed until its provider has returned a confirmed outcome.
