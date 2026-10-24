# Data model: extend current entities

Design only. Canonical implementation remains in existing Zod/Pydantic contracts, not parallel MCP models/tables. Unknown facts retain null/unknown and evidence status. Money uses safe integer minor units and ISO currency.

## Provider capability/readiness

Extend current provider declarations with active canonical provider IDs `duffel` (flight), `nuitee` (accommodation) and `viator` (activity), display attribution, mode, supported component/property types, query fields, market/party coverage and operation limits. Retain legacy Duffel accommodation and `booking`/`booking.com`, `trainline`, `getyourguide` only for saved-data compatibility and approved reconciliation, never as active defaults or relabelled inventory. Nuitee Flights/Experiences remain inactive. Synthetic identities remain test-only and match current supplier scope.

Each operation has separate support (`supported | unsupported | unknown`) and access (`unconfigured | configured_unverified | verified | blocked`), safe reason, verification time/evidence reference and prerequisites. Operations include search, detail, read-only revalidation; restricted declarations additionally include book/status/idempotency/cancel/reschedule. Credential configuration alone cannot establish verified access. Deadline/rate/freshness policy comes from approved configuration; unknown coverage or limits are not “all” or invented values.

Readiness is keyed by provider, component type, operation and configured environment: Duffel flight, Nuitee accommodation and Viator activity evidence are independent. Missing Nuitee access must not block Flights/Viator, or vice versa. Nuitee hotel access/shared authentication never enables Flights/Experiences. Rail queries return explicit unsupported/deferred outcomes with no fabricated provider or inventory. Provider identity is not a substitute for product readiness.

Credential references stay private. When both Duffel roles are configured, `readSecretRef` and `transactionSecretRef` must be distinct and resolve to separate discovery/booking keys; the booking key is worker-only. Either role may be unconfigured. The discovery key needs offer-request creation permission (upstream read-write when no narrower permission is available), so its local read role must not be described as a proven upstream read-only scope. A fixed search/offer-read allowlist, not the variable name, prevents consequential actions. Nuitee and Viator may each use a shared secret reference/value across trusted web/worker processes under their documented authentication model, without pretending these are separately scoped upstream keys. Web clients enforce fixed non-transactional allowlists; public capability summaries expose neither references nor values. Key presence does not prove booking/payment entitlement. Nuitee environment is explicit; prebook is excluded from read capabilities until no-hold/no-payment semantics are established.

On 2026-10-24 the user chose to reassign the tested sandbox variable
`DUFFEL_TRANSACTION_SECRET` to the **discovery role only**, with no configured
`transactionSecretRef`. The variable label is not authority: worker readiness remains
unconfigured despite the environment value existing. This uses the existing optional
role model, not a shared-key exception, implicit credential escalation or a new mode.
The current provider mode remains deterministic and simulated checkout stays client-only.
Observed EUR source money must not be relabelled GBP or converted without sourced FX.

Expose safe relevant capability summaries, never secrets, commercial account IDs or internal diagnostics. Extend the existing read capabilities and transaction adapter declarations, not another registry.

Viator additionally records `accessTier` (`unknown`, `affiliate_basic`,
`affiliate_full`, `affiliate_full_booking`, `merchant`; omitted means unknown).
Tier cannot substitute for verified operation/environment evidence. Basic or
unknown access cannot enable the current worker's merchant booking actions;
Full Access + Booking may support approved saved status but does not imply
merchant booking access. Public readiness publishes only safe operation
support/access/reasons, not credential references or private commercial data.

## PlanningOffer and stored research

Evolve the existing `PlanningOffer` and `planningOfferRecords`:

- Preserve component/service type, eligibility, occupancy, accessibility, attribution, unverified facts and requirement grouping. Property type remains `planningDetails.accommodationType`; no second lodging taxonomy.
- Add opaque record reference/revision, source mode and query/product/party fingerprint. Stable identity includes provider, component type, provider offer, requirement, dates, fare/room allocation and query context; provider offer ID alone need not identify equivalent inventory. Preserve Nuitee hotel/room/rate/offer and sourced session references, plus restricted prebook/booking correlation references where approved, and Viator product/option/availability references. Historical Duffel Stays references remain unchanged; never route them to Nuitee or through flight operations. Secret/payment-session fields are not public offer evidence.
- Owner/trip/base version comes through the existing run relation. An offer reference never grants access. Server-approved selected references from prior research retain provenance and receive a grant in the new refinement run only after same-trip/current-version ownership validation.
- Track `estimated | quoted | live_revalidated | expired` research evidence separately from `available | unavailable | unknown` availability and from accepted component booking status. Add checked/expiry and immutable material-fact evidence revision.
- Missing source service dates, required details and customer price/tax/fee facts may be nullable in this same discovery offer using shared component/price field definitions. Expand unverified-fact reasons. Do not invent times, zero mandatory charges, eligibility, baggage inclusion or favourable refundability.
- Nuitee cheapest listing price is incomplete until the selected multi-room offer and current evidence establish mandatory totals/terms. Preserve deposits, included/excluded mandatory taxes/fees, due-at-property amounts/currencies and payment timing without double counting; unresolved mandatory amounts or unsupported payment schedules block authorization. Convert documented decimal amounts exactly to safe minor units. Preserve only sourced property types; synthetic variants do not prove live coverage. No invented offer/session expiry or prebook-as-idempotency guarantee.
- Required Nuitee `guestNationality` and per-room `occupancies`/child ages derive from trusted permitted facts. Missing facts return explicit prerequisites, not guessed values. Refresh via rates alone is not final checkout revalidation. Prebook creation/payment state is private transaction evidence, not a read operation unless an approved no-hold/no-payment variant is established; otherwise authorization remains blocked.
- Stable anonymous party slots are derived server-side from accepted party/version; adult IDs are not randomly regenerated per search. Child eligibility uses service-date age where trusted evidence supports it; otherwise unknown.
- Bound and allowlist provider text, facts, attribution URLs and safe error codes. Raw payloads and hidden fields cannot pass through nested details or notes.

Only complete, current candidates materialize through existing repricing/proposal validation into strict `travelComponentSchema`. Incomplete research cannot introduce nullable service times into accepted components. This limited shared-schema extraction supports uncertainty without creating another normalization system.

Reuse current offer records/run ownership. Add revision/evidence metadata to existing records; use compare-and-swap or versioned evidence rows associated with the existing offer identity if needed for immutable detail/revalidation snapshots, not a second offer store. Retain source query and original facts. Legacy missing evidence is unknown and cannot be promoted to live. Persist read-only research under the existing run lifecycle with new `supplier_research` purpose; no proposal or trip version is created by that purpose.

## Derived requirement coverage

Input: one accepted trip/version, supplier evidence and durable confirmations. Output: coverage policy version, trip version, report fingerprint, safe issues and requirement entries. This report is derived, never another authoritative trip.

| Field         | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| requirementId | Stable route-leg/date, stay-destination/night/room-party, or paid itinerary-item identity |
| kind          | transport, accommodation, activity                                                        |
| sourceRefs    | Accepted destinations, itinerary items, constraints, party slots                          |
| coverage      | missing, covered_unverified, eligible_unbooked, confirmed, not_required, blocked          |
| componentIds  | Exact components satisfying the requirement, with bundles/room allocations                |
| issues        | Safe code/message, affected references, resolution action                                 |

Derive outbound/inter-destination/return legs unless accepted self-arranged/not-required evidence covers them. Derive stay-night and room-party coverage from dated destinations, not the count of accommodation components. Paid activities derive from accepted components and booking classification. Add optional `bookingDisposition: required | not_required | unknown` plus source/verification to current itinerary/travel facts where needed. Missing legacy classification remains unknown unless authoritative facts prove otherwise. A planning note or agent guess cannot silently waive required booking.

Cover each required party/service interval once; a bundle may satisfy multiple requirements but its price is counted once. No incompatible inventory reuse. Reuse feasibility timing/constraint checks, but generic acknowledgement cannot satisfy unknown hard booking facts. Required unsupported transfers block coverage. Confirmations cover only matching durable commitments, regardless of offer expiry. A nonempty fully resolved required set is necessary; confirmed-only trips have no new action to authorize.

No deferred provider is a global completeness prerequisite. A complete flight/stay/activity trip can be eligible without Booking.com or Trainline. A required rail leg without authoritative confirmed/self-arranged/not-required evidence stays blocked; provider deferral cannot waive it or authorize booking only the other components.

Recompute at review, authorization, start and dispatch. The fingerprint binds policy, source trip/version, mapping and material eligibility evidence, not incidental polling timestamps.

## BookingTerms v2

Extend the existing terms schema with a v2 discriminated variant for new whole-trip execution. V1 without a discriminator retains its exact parser/hash for historical reads and reconciliation.

- `schemaVersion: 2`, trip version, coverage policy/fingerprint and complete requirement mapping.
- Existing origin/party facts and anonymous traveller references; necessary non-sensitive eligibility facts. Sensitive identity/payment prerequisites use opaque trusted references plus immutable version/fingerprint. No names, passports or payment values enter public terms.
- Full component set, each with canonical provider/attribution, offer/inventory/product identity, actual dates/timezones/service/fare/property/occupancy facts, customer payable amount/currency, mandatory tax/fee inclusion, material booking/refund/change/cancellation/baggage/non-reversible terms, required verified constraint/accessibility evidence, checked time and expiry.
- Disposition `already_confirmed | to_book`. Confirmed entries bind durable confirmation/material facts, not a new expiring offer. Only to-book entries generate writes.
- Existing `totalPrice` means exact remaining amount payable for this authorization and equals the to-book customer sum. Display full-trip customer summary and committed amounts separately; do not combine currencies without approved conversion evidence or count taxes/fees twice.
- Non-reversible acknowledgement IDs match exactly the applicable to-book component set.
- `continuationOf` and `rootAttemptId` are null on initial attempts and server-derived for recovery. They bind every unresolved requirement and confirmed commitment, not a traveller-selected subset.

All material fields participate in canonical hashing. Incidental attempt status/polling timestamps do not. Persisted revalidation is authority; client cannot supply replacement terms. New starts require complete v2 evidence. Historical immutable JSON/hashes are never rewritten.

Authorization rows retain current owner/trip/version/operation/terms/hash/acknowledgements/expiry/status. Reuse existing idempotency records for `(owner, trip, authorization requestId)` and full fingerprint: same request replays; altered facts conflict. Existing separate cancellation/rescheduling terms remain exact-action boundaries, not MCP capabilities.

## Booking attempts, claims and truth

Extend existing transactions/execution basis with terms version and immutable parent/root lineage. Keep current per-component attempts, claims, confirmations and callback/version evidence. Transaction components are the entire to-book set; review retains the whole trip.

Attempt/claim identity binds provider, component/requirement, operation, exact request fingerprint and stable key. Cross-attempt confirmed/in-flight guards prevent a second authorization or continuation rebooking the same commitment. A new provider key does not clear an unknown prior outcome.

Persist provider evidence, outcome, confirmation, duplicate guard and resolved-claim release atomically. Provider network calls remain outside transactions. Recording authenticated truth cannot depend on execution authority being active. If a changed trip prevents safe projection, persist truth and expose action required without overwriting accepted edits or losing the booking. Keep unresolved evidence/claims until status/manual reconciliation establishes truth.

Present not-attempted from no dispatched attempt plus stopped/blocked execution; do not turn it into definitive failure. Add a persisted lifecycle value only if existing status/evidence cannot represent that fact. Contradictory callbacks create an evidence conflict requiring reconciliation; never silently overwrite confirmation or enable retry.

| Entity          | Progression                                                                       | Invariant                                             |
| --------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Research        | estimated/quoted -> live check/changed/unavailable/unknown -> expiry/new revision | No trip mutation, reservation or transaction          |
| Proposal        | proposed -> validated accepted/applied, rejected or stale                         | Existing manual/automatic policy, version/history     |
| Authorization   | authorized -> consumed, invalidated or expired                                    | Exact complete basis; no reuse for changed facts      |
| Attempt         | claimed -> dispatched -> confirmed, failed or uncertain/action required           | Possible commit blocks new writes across attempts     |
| Uncertain write | status evidence -> confirmed, definitive non-commit, or uncertainty               | Time elapsed or missing status never permits retry    |
| Execution       | active -> stopped/expired/invalidated/completed                                   | May block writes; never suppress authenticated truth  |
| Continuation    | unresolved work -> complete review -> new authorization -> linked attempt         | Confirmed commitments excluded from writes/new amount |

Use existing lock order: planning/booking trip access lock, transaction and component claims. Atomically fix the dispatch basis and reject material edits or competing claims while dispatched/unknown. Continuation reuses these locks/guards rather than a separate recovery engine.

## Compatibility and privacy

Append migrations after 013. Update existing database types, canonical schemas and generated fixtures. Missing metadata becomes unknown, not verified. Preserve original terms/hash, confirmations and run policy. New starts require v2; legacy pending starts require fresh review while reconciliation remains available. Prove fresh/upgrade/read compatibility and safe mixed-version rollout.

Use explicit public field allowlists, including nested supplier strings, rather than assuming price removal sanitizes all data. Trusted identity/payment prerequisites remain server-only; public status exposes completion/missing state and opaque IDs. Audit uses safe references, actor/version/outcome/timestamps, not raw terms text or provider payloads. Existing retention/legal hold applies; no new default deletion of immutable evidence.
