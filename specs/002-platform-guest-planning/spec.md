# Feature Specification: Platform UX, Guest Planning & Account Creation

**Feature Branch**: `main` (no branch hook configured)

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Make the platform inviting and self-explanatory with a marketing homepage, globe-first trip setup, account-free planning, and free registration only at the booking boundary, preserving existing architecture, planning rules, and booking safeguards."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Start with Destinations and Build a Guest Estimate (Priority: P1)

As a visitor, I want to start with an inviting globe, choose my destinations, and complete a guided setup without registering, so that I can discover a useful trip before committing to an account.

**Why this priority**: This is the primary product entry and first useful outcome.

**Independent Test**: Open `/trips/new` signed out, select a country and two cities, reorder and replace a destination, complete setup, request an estimate, and explicitly accept it. Reload restores the accepted trip without asking for registration.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor opens `/trips/new`, **When** the page loads, **Then** the interactive globe is the prominent initial destination-selection experience, search and an ordered selection list are available, and no sign-in or account-creation gate appears.
2. **Given** selected countries and cities, **When** the visitor adds, removes, replaces, or reorders a destination through globe or list controls, **Then** all views show the same destination identities and route order; replacement keeps the selected position, and a clear Continue action leads to the next setup step.
3. **Given** setup is partially complete, **When** the visitor moves backward, revisits a completed step, refreshes, or returns in the same valid guest session, **Then** saved entries and the current step are restored, and incomplete fields remain editable without being represented as a valid estimated trip.
4. **Given** the visitor proceeds through origin, dates and duration, travellers, preferences, requirements, and review, **When** a required value is missing or inconsistent, **Then** the affected field and correction are identified in context; estimate research is blocked until the setup is valid and the departure city or airport is explicitly confirmed.
5. **Given** valid reviewed setup, **When** the visitor requests an estimate, **Then** research progress, clarifications, and a reviewable proposal are shown without applying it; only explicit acceptance creates the next accepted trip version.
6. **Given** the globe fails or the visitor uses only a keyboard or screen reader, **When** they use search and the ordered list, **Then** they can perform every destination operation and complete the same setup without the globe.

---

### User Story 2 - Continue and Refine a Private Guest Trip (Priority: P1)

As a guest, I want my planning progress to remain private and recoverable, so that I can refine and finalize my trip without registering or losing accepted changes.

**Why this priority**: Removing the account gate is useful only when persistence and ownership remain trustworthy.

**Independent Test**: Seed an accepted guest estimate, reload it, request and accept a refinement, undo an accepted change, and finalize where supported. A different guest or unrelated account cannot access that trip or its research and conversation records.

**Acceptance Scenarios**:

1. **Given** a guest has accepted an estimate, **When** they reopen its trip workspace within the session lifetime, **Then** the same trip, accepted versions, retained conversation, proposals, and research status appear with consistent summary, map, itinerary, and pricing views.
2. **Given** a guest requests a direct or conversational change, **When** they review and accept the validated change, **Then** the existing impact review, version creation, stale-proposal rejection, and undo rules apply; no reservation or payment occurs.
3. **Given** an unrelated guest or account knows a trip, proposal, conversation, or run identifier, **When** they attempt a read, mutation, history read, or event subscription, **Then** access is denied without exposing private trip content.
4. **Given** a guest session has expired or its browser credential has been cleared, **When** the visitor returns to a private trip link, **Then** the interface explains that guest access is unavailable and offers a fresh planning path; the link alone cannot recover ownership.
5. **Given** research delivery or saving is interrupted, **When** the guest reconnects or retries, **Then** recorded progress is recovered or a retryable failure is shown, acknowledged saved changes remain present, and retries do not duplicate trip creation or apply proposals automatically.

---

### User Story 3 - Create a Free Account at Booking and Resume Safely (Priority: P1)

As a guest ready to book, I want to sign in or create a free account and return to my trip, so that I can review live terms without rebuilding my plan.

**Why this priority**: This joins guest planning to the existing transactional workflow without weakening authorization.

**Independent Test**: From a seeded eligible guest trip, choose booking, exercise both sign-in and sign-up, and verify the same trip identity and history after linking. No booking authorization, reservation, or payment results from authentication or linking.

**Acceptance Scenarios**:

1. **Given** an eligible guest trip, **When** the guest chooses booking, **Then** the platform explains that an account is needed to associate booking actions and confirmations with them, states that registration is free with no subscription requirement, and offers sign-in, sign-up, and return to planning.
2. **Given** a guest completes either authentication option, **When** their trip is linked successfully, **Then** they return to the intended trip's booking review with the same trip identifier, accepted version numbers, settings, retained history, and progress; account creation does not require payment information.
3. **Given** authentication is cancelled, fails, or encounters an existing email address, **When** the guest returns or corrects the error, **Then** planning remains available and unchanged, useful validation appears, and an existing account can be signed into without creating a duplicate account.
4. **Given** linking is retried, two tabs authenticate concurrently, or saving overlaps linking, **When** the operations settle, **Then** at most one account owns the trip, acknowledged saves survive, no duplicate trip or version is created, and conflicting claims receive a recoverable access outcome.
5. **Given** research is active during linking, **When** the visitor resumes planning, **Then** completed evidence remains available and active research either resumes under the valid owner scope or becomes visibly retryable; linking cannot accept a proposal or discard an accepted version.
6. **Given** an authenticated linked trip, **When** booking review resumes, **Then** current eligibility, version, live availability, prices, and terms are checked; explicit confirmation of exact current terms remains necessary before any booking or payment.
7. **Given** a malicious return destination or a request to book a trip belonging to someone else, **When** authentication completes, **Then** no external redirect or unauthorized trip access occurs.

---

### User Story 4 - Understand the Product from the Homepage (Priority: P2)

As a visitor, I want to understand what the platform does and how to start, so that I can confidently begin planning.

**Why this priority**: The homepage establishes value and expectations before the product experience.

**Independent Test**: Visit `/` without an account and identify the value proposition, process, example travel content, trust information, and primary action; following that action opens `/trips/new`.

**Acceptance Scenarios**:

1. **Given** a visitor opens `/`, **When** they read the page, **Then** it explains AI-assisted multi-destination planning, presents a prominent planning CTA, describes selecting destinations, reviewing an estimate, refining, and choosing booking, and states that planning needs no account.
2. **Given** travel imagery or sample itineraries appear, **When** the visitor evaluates them, **Then** examples are clearly illustrative, informative images have descriptive alternatives, and claims about savings, providers, endorsements, security guarantees, or availability are supported by actual product evidence.
3. **Given** homepage navigation, **When** the visitor selects planning, sign-in, or sign-up, **Then** the appropriate route opens; the homepage remains a marketing page without an embedded interactive trip builder.

---

### User Story 5 - Plan Comfortably Across Devices and Access Needs (Priority: P2)

As a traveller, I want a coherent, responsive interface with helpful feedback and restrained motion, so that I can complete planning regardless of device or access needs.

**Why this priority**: Visual polish must support comprehension and reliable interaction throughout the core journeys.

**Independent Test**: Exercise homepage, setup, estimate review, refinement, and authentication at mobile and desktop sizes, with keyboard, screen reader, zoom, reduced motion, loading states, and simulated failures.

**Acceptance Scenarios**:

1. **Given** mobile and desktop layouts, **When** a traveller progresses through setup, **Then** headings, spacing, controls, progress, back navigation, and the trip summary remain readable and reachable; a compact expandable summary may replace a desktop persistent summary without covering controls.
2. **Given** loading, no search results, successful saves, accepted estimates, or failures, **When** the state changes, **Then** the traveller receives an understandable status and next action, preserving entries and preventing repeated submission while an action is pending.
3. **Given** ordinary motion settings, **When** the globe enters, destinations change, or a step changes, **Then** subtle transitions support continuity without delaying interaction or causing focus loss.
4. **Given** reduced-motion preferences, **When** the same journeys run, **Then** decorative movement and automatic globe rotation are suppressed and all functions remain available.

### Edge Cases

- Ambiguous city names, country-level choices without a city, repeated selection of the same place, and destinations without precise coordinates: preserve geographic identity, clarify ambiguity, prevent exact duplicates, and do not invent a city or verified transport route.
- Empty destination list, the existing eight-destination limit, invalid dates, duration outside availability, missing child ages, and conflicting required constraints: preserve existing validation and explain the relevant correction.
- Globe rendering, map worker, destination search, imagery, or provider outage: keep existing selections, show a usable fallback or retry, and never represent an unavailable estimate as successful.
- Two guest tabs edit different versions or submit repeatedly: surface conflicts and replay completed requests safely without silently overwriting acknowledged changes.
- Browser storage is unavailable, session creation fails, or saving is offline: explain recovery limits, retain visible entries while possible, and do not claim unsaved content is durable.
- A person signs into an account that already has trips: link only the proven current guest trip selected for continuation, preserve existing account trips, and do not combine itineraries by matching titles.
- Linking fails after authentication or succeeds before the response is lost: show a retryable continuation; repeated linking resolves the original outcome and does not strand the trip.
- A guest credential is reused after linking, a user signs out on a shared device, or a session expires during booking: deny old access, avoid exposing account trips in a new guest session, and require authentication plus current-term authorization before further consequential actions.
- A proposal expires or live terms change during authentication: preserve accepted history, disclose stale pending work, and require new review rather than treating sign-in as consent.
- The trip is not finalized or supported booking is unavailable: explain the existing prerequisite or unavailable capability instead of promising executable booking.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `/` MUST be a public marketing homepage with a clear value proposition, prominent CTA to `/trips/new`, process explanation, attractive travel imagery or illustrative itineraries, key benefits, evidence-based trust information, and simple planning and authentication navigation. It MUST NOT duplicate the interactive builder or claim unsupported product capabilities.
- **FR-002**: `/trips/new` MUST be publicly accessible and begin with a visually dominant interactive globe for selecting countries and cities. Search and an ordered destination list MUST be immediately available. The globe MUST appear by default when rendering is supported rather than behind an optional-map toggle.
- **FR-003**: Globe and non-map controls MUST support adding, removing, reordering, and replacing destinations and show the same selection and route order. Replacement MUST preserve route position; exact duplicate places MUST be prevented, different cities in the same country MUST remain selectable, and the existing one-to-eight destination rule MUST hold.
- **FR-004**: Destination selection MUST preserve existing country, place identity, timezone, and available geographic data. Ambiguous selections MUST require review; country selection MUST NOT silently select a city. Route connections MUST remain distinguishable from verified travel paths.
- **FR-005**: After destination selection, setup MUST use focused steps on `/trips/new`, in the default order: departure origin; dates and duration; travellers; travel preferences and free-text requirements; setup review and estimate request. Each step MUST provide clear progress and forward/back navigation, with a readily available current trip summary on mobile and desktop.
- **FR-006**: Setup MUST preserve title, presentation currency, confirmed origin, preferred and flexible availability windows, minimum/ideal/maximum duration, adult and child counts and child ages at trip start, all five existing preference dimensions, and reviewable requirement wording, priority, provenance, and status. Existing domain limits and feasibility rules MUST remain applicable.
- **FR-007**: Departure origin MUST be explicitly confirmed as a city or airport with country and timezone before estimate research; return MUST default to that origin. Neither account identity nor browser location MUST silently supply confirmation. Preferred dates MUST remain unchanged unless the traveller explicitly accepts an alternative.
- **FR-008**: Steps MUST validate affected inputs in context, identify corrective actions, and retain entries when moving between steps. Invalid dependent settings introduced by an earlier edit MUST be highlighted before submission. Saved incomplete setup MUST remain distinct from a valid authoritative trip version.
- **FR-009**: Guests MUST be allowed to search, configure, request estimates, answer clarifications, review and accept estimates, refine through existing direct and conversational controls, inspect retained versions, undo eligible changes, and finalize where supported without account creation. Existing account holders MUST retain equivalent planning functionality.
- **FR-010**: Estimate requests MUST authorize research only. Initial estimates and refinements MUST use the existing explicit proposal review and acceptance boundaries, base-version validation, durable event/result recovery, reversible version history, and consistent workspace views. Submission, page navigation, animation, session creation, and authentication MUST NOT accept a proposal.
- **FR-011**: Estimated prices, synthetic examples, expired information, unverified feasibility facts, and live booking terms MUST retain their existing distinctions. Customer views MUST continue to omit supplier costs and platform margin while showing customer totals, currency, required taxes, fees, and disclosures.
- **FR-012**: The platform MUST establish a private anonymous planning session without registration, personal identity details, payment information, or subscription. Access MUST depend on possession of a valid protected browser session credential checked against durable ownership records, not on a trip identifier or user-supplied owner identifier.
- **FR-013**: Incomplete setup and its current step MUST be recoverable within the valid session after refresh or return. Submitted trips, accepted versions, proposals, conversations, research runs and receipts MUST use the existing durable trip storage and authoritative version model. Browser-only state MUST NOT be the sole record of an accepted trip.
- **FR-014**: Every guest trip read and mutation, retained version, conversation, proposal, research run, clarification, and event feed MUST enforce the same owner scope. Anonymous access MUST NOT grant booking, payment, internal diagnostic, provider callback, or privileged service permissions. Existing request-origin checks and private-response protections MUST remain enforced.
- **FR-015**: Guest session credentials MUST be protected against script access and transport exposure, MUST NOT appear in URLs, conversation, logs, or customer-visible content, and MUST expire after 30 days of inactivity by default. The interface MUST explain that guest recovery depends on the same browser session and show a clear expired-access outcome. Credential expiry MUST NOT silently delete accepted history; existing retention and review rules remain applicable.
- **FR-016**: Anonymous research MUST have bounded request frequency and concurrent work, with understandable retry guidance and no account/subscription gate. Repeated requests MUST preserve existing duplicate prevention; saving failures MUST be disclosed rather than acknowledged as successful persistence.
- **FR-017**: An account MUST be required only on entry to booking. The boundary MUST explain its purpose, offer sign-in and free sign-up with no subscription or payment-information requirement, and allow returning to guest planning. Direct booking entry and booking operations MUST enforce this boundary even when bypassing the interface.
- **FR-018**: The platform MUST retain `/sign-in` and provide `/sign-up` using the existing email/password account capability and account conventions. Both flows MUST provide accessible validation and pending/error states; an existing account MUST have a sign-in path. Optional authentication elsewhere MUST NOT become a planning prerequisite.
- **FR-019**: Successful authentication MUST prove both the guest session's authority over the selected trip and the account's identity before linking. Linking MUST preserve the trip identifier, current version, accepted snapshots, reversal relationships, proposal references, retained conversations, research results, and existing request receipts. It MUST NOT copy the trip into a second independent record or merge it with unrelated account trips.
- **FR-020**: Linking MUST be atomic, auditable, and safe to retry. Concurrent edits and competing claims MUST be resolved against current ownership, preserve acknowledged changes, and leave one owner. A completed repeat claim by the same account MUST resolve to the same trip; a claim by another account MUST fail without disclosing it. The previous guest credential MUST lose access to the linked trip after success.
- **FR-021**: Linking MUST preserve consistent ownership across all related planning records. In-flight research MUST either continue with valid scoped authority or stop with a visible safe retry; old owner-scoped credentials MUST NOT mutate a linked trip. Accepted versions and recorded results MUST remain available, and linking MUST NOT reset proposal expiry or revive stale proposals.
- **FR-022**: Authentication cancellation or failure MUST preserve guest planning progress. Linking failure after successful authentication MUST provide a retryable path for completing continuation without creating another trip. Sign-out MUST NOT expose linked account trips through a new guest session.
- **FR-023**: After authentication and successful linking, the traveller MUST return to the intended, authorized booking review for the same trip. Continuation MUST be restricted to safe application destinations, resolve current state rather than trusting old browser data, and enforce existing finalization and capability prerequisites.
- **FR-024**: Authentication and linking MUST NEVER authorize a booking, payment, cancellation, or rescheduling. Booking MUST retain live revalidation, explicit authorization of exact current material terms, expiry checks, material-change invalidation, serialization of affected edits and provider writes, duplicate prevention, durable component outcomes, and partial-failure recovery from the existing specification.
- **FR-025**: The interface MUST use consistent typography, spacing, visual hierarchy, theme, and control behavior across homepage, setup, planning, and authentication, with clear loading, empty, success, validation, and error states. New visual treatment MUST preserve recognizable trip summary, map, conversation, history, price, and booking functions.
- **FR-026**: Core journeys MUST remain usable at 320 CSS pixels wide and at 200% zoom without page-wide horizontal scrolling, clipped controls, or summaries obscuring content. Interactions MUST support keyboard operation, logical focus, visible focus indicators, screen readers, sufficient contrast, and touch targets at least 44 by 44 CSS pixels. State MUST NOT rely solely on color, animation, or globe interaction.
- **FR-027**: Step transitions MUST move focus logically to the new step heading or relevant validation error and announce progress and asynchronous outcomes. Search, ordered-list selection, and all booking-boundary actions MUST provide equivalent non-visual operation.
- **FR-028**: Decorative globe entrance, selection feedback, and setup transitions MAY use subtle animation, but MUST respect reduced-motion preferences, avoid automatic rotation under reduced motion, preserve focus and state, and never delay or block actual input, validation, navigation, or booking review.
- **FR-029**: Existing account-owned trips and accepted history MUST remain accessible after the feature is introduced. Guest ownership and incomplete drafts MUST be accommodated within the existing storage architecture with compatible transitions; the feature MUST NOT replace the authoritative trip model, reinterpret historical consent, or weaken the domain and booking rules of `001-ai-trip-agent`.

### Key Entities _(include if feature involves data)_

- **Anonymous Planning Session**: A temporary private owner context, protected browser credential, last activity, expiry, and authority over its unlinked drafts and trips; not a registered customer account.
- **Setup Draft**: Incomplete selected destinations and setup entries, current step, save state, and associated guest or account owner; not an accepted estimate or valid trip snapshot until validated and submitted.
- **Trip and Trip Version**: The existing authoritative plan and immutable accepted history, preserving identifiers, material facts, proposal references, and reversal evidence across ownership linking.
- **Planning Evidence**: Existing proposals, retained conversation, research runs, events, results, and request receipts associated with the same authorized trip and version scope.
- **Registered Account**: An existing or newly created free customer identity that owns linked trips and can enter booking, without implying financial authorization.
- **Account Link Receipt**: Durable evidence of the proven guest-to-account ownership transition, selected trip, resulting owner, and repeatable outcome; no independent itinerary copy.
- **Booking Continuation**: The selected trip and intended booking-review action preserved across authentication, subject to fresh ownership and lifecycle checks; never booking consent.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least 18 of 20 first-time test participants correctly identify multi-destination AI planning, account-free planning, and the main planning CTA after no more than 60 seconds on the homepage without assistance.
- **SC-002**: At least 18 of 20 participants complete and submit valid multi-destination guest setup within eight minutes of opening `/trips/new`, without registration or assistance; research generation and proposal-review time are excluded, matching the existing setup target.
- **SC-003**: At least 18 of 20 participants can add, reorder, replace, and remove destinations and reach the next setup step within three minutes; all keyboard/screen-reader participants can complete the equivalent non-globe task.
- **SC-004**: In 100% of persistence scenarios covering step backtracking, refresh, browser return with a valid session, interrupted saving, and duplicate submission, acknowledged entries and accepted versions are recovered without duplicate trips or silent overwrite.
- **SC-005**: In 100% of access scenarios, an unrelated guest/account, an expired session, an old credential after linking, or possession of identifiers alone cannot read or mutate another owner's private trip, history, conversation, proposals, or run events.
- **SC-006**: In 100% of linking scenarios, including simultaneous claims, account trips already present, active research, response loss, and retries, exactly one authorized owner retains the original trip and accepted versions; no independent duplicate trip is created.
- **SC-007**: At least 18 of 20 participants can identify why an account is required, choose the appropriate sign-in/sign-up option, and resume the intended trip's booking review within three minutes of beginning authentication, excluding only time waiting for external delivery or service outages. No participant is required to provide payment information or select a subscription to register.
- **SC-008**: In 100% of transaction regression scenarios, guest planning, authentication, linking, redirects, and repeated submissions cause zero unauthorized reservations or payments; material changes still require renewed exact-term confirmation.
- **SC-009**: Every core journey passes keyboard and screen-reader verification, reduced-motion checks, and mobile/desktop checks at 320, 390, 768, and 1440 CSS pixels plus 200% zoom, without loss of controls, unreadable summaries, or map-only information.
- **SC-010**: At least 18 of 20 participants rate the interface's clarity and ease of navigation at least 4 out of 5 after setup and booking-boundary tasks. In deterministic successful scenarios, actions acknowledge input within one second and no action waits for a decorative animation to finish.

Use the existing minimum 20-person usability protocol, including at least five keyboard-only or screen-reader users, five family planners, and five multi-destination planners; groups may overlap. Freeze task briefs, fixtures, scoring, and denominators before implementation. Include failures in denominators and distinguish deterministic evidence from live-provider timing. Regression scenarios MUST include successful, denied, interrupted, expired, concurrent, and replayed paths; existing planning and booking safeguards remain separate mandatory gates.

## Assumptions

- This feature extends [the existing AI trip-agent specification](../001-ai-trip-agent/spec.md), explicitly replaces its deferred account-policy assumption with guest planning and booking-only authentication, and preserves its remaining domain rules, feasibility policy, capability gates, and transaction safeguards.
- Codebase inspection occurred before drafting; [codebase context](codebase-context.md) records the routes, authentication, persistence, UI, and mapping evidence and architecture constraints for planning.
- The user explicitly requires reuse of shadcn/ui as much as practical alongside existing components and theme conventions. The current component set is limited; planning must reconcile reuse and additions rather than assume a complete design system already exists.
- The existing MapLibre mapping, local country data, worker arrangement, and destination identities are the starting point for the globe. Existing animation support is preferred; new mapping or animation dependencies require a clear demonstrated reason during planning. This is a reuse constraint, not a specification of a new library.
- The default guest lifetime is 30 days of inactivity. Existing raw-conversation expiry of 90 days and trip-record review after 24 months of inactivity continue unless the responsible retention policy explicitly changes them; access expiry is distinct from record deletion.
- Guest recovery across devices, public share links, collaborative trip ownership, social login, subscriptions, new providers, altered booking execution, and changed travel-domain limits are outside this feature. Registration uses the existing email/password capability.
- Linking applies to the current guest trip selected for continuation. Other guest drafts are not silently claimed; existing account trips remain separate. A linked trip becomes accessible through its account rather than the former guest credential.
- Guests may finalize before authentication when the existing capability permits it. Booking eligibility still follows existing finalization and supported-provider checks; the marketing page must reflect actual enabled capabilities.
- Travel imagery and example itineraries must have appropriate usage rights and must not imply customer endorsements, live inventory, guaranteed savings, or completed bookings.
