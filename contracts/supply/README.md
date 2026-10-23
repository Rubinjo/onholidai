# Travel Supply Contract

The first-party `travel-supply` boundary currently uses Duffel flights, Nuitee stays and Viator activities. Trainline rail and other legacy providers retain their historical attribution but are not active discovery or new-booking products. Nuitee Flights and Experiences remain inactive. Adapter-specific payloads remain behind this boundary.

## Capability Separation

### Read Interface

Callable by planning services and approved agent MCP adapters:

- `searchOffers(criteria, deadline)` returns normalized estimated or quoted offers with source and freshness.
- `getOffer(offerId)` returns current known details without changing provider state.
- `revalidateOffers(offerIds, travellers, dates)` returns immutable live terms or explicit changed/unavailable outcomes.
- `getBookingStatus(providerReference)` performs a read-only reconciliation query.

Read calls cannot reserve inventory, incur a charge, cancel, or reschedule.

Discovery rates are not final checkout terms. A restricted adapter may supply whole-trip
revalidation only when it explicitly declares `revalidation: read_only_final_terms` and
its supported product and side-effect-free final-term semantics have been approved.
Unverified or absent capability returns `unknown` without calling the adapter.
Nuitee fresh rates, `usePaymentSdk=false`, and unverified prebook do not qualify.
The production transaction registry currently has no approved final-term reader.
Supplier and trusted prerequisite reads have bounded deadlines; exceptions do not
become definitive unavailability or invented final facts.

### Transaction Interface

Callable only from authorized Temporal activities using restricted credentials:

- `book(liveOffer, travellers, idempotencyKey)`
- `cancel(confirmedBooking, authorizedTerms, idempotencyKey)`
- `revalidateReschedule(confirmedBooking, requestedChange)`
- `reschedule(confirmedBooking, authorizedTerms, idempotencyKey)`

The transaction interface is never registered as a LangGraph or MCP tool available to the model.

## Normalized Offer

Every offer includes:

- internal and provider offer identifiers;
- provider and component type;
- service dates/times with timezones;
- traveller eligibility and occupancy;
- normalized service details appropriate to flight, stay, activity, rail, or transfer;
- supplier amount, taxes, fees, final customer amount, and ISO currency;
- estimate/live state, checked time, and expiry;
- cancellation, baggage, change, and booking conditions where available;
- accessibility facts and their verification status;
- source attribution and safe raw-payload reference for authorized diagnostics.

Missing facts are represented as unavailable or unverified, never inferred as favourable.

## Revalidation Result

Each requested component returns exactly one outcome:

- `unchanged`: live terms match the proposed component;
- `changed`: live terms are available but material facts differ;
- `unavailable`: provider confirms no bookable offer;
- `unknown`: truth cannot be established before the deadline.

A canonical authorization snapshot may include only unexpired `unchanged` or traveller-accepted `changed` terms. The snapshot includes the exact normalized fields, confirmed departure origin, and a deterministic hash. Booking status, lifecycle and provider-confirmation reference are excluded from material-term comparison; offer/inventory identity, dates, travellers, prices/currency and cancellation conditions are retained. A confirmation with changed material terms stops remaining writes.

Whole-trip terms use `schemaVersion: 2`: every route leg, stay night/room/party,
required activity and paid transport must have verified coverage or a separately
trusted non-booking classification. Confirmed commitments remain bound to durable
confirmation evidence and are not revalidated as expiring offers. Their original
currency is preserved; remaining payable is only the exact to-book customer sum.
No mixed-currency amounts are combined without approved conversion evidence.
Property/room, fare/baggage, refund/change, included mandatory taxes/fees,
non-reversible actions and opaque traveller/payment readiness versions are bound.
Raw identity, payment secrets and supplier economics never enter customer DTOs.
Missing legacy service/timezone facts remain explicitly unknown.

The original unversioned v1 parser and hash remain unchanged for historical reads,
reconciliation and separately authorized cancellation/rescheduling. A new whole-trip
v1 start is rejected. Authorizations use owner/trip/request identity plus a full
fingerprint; replay returns the original receipt without reviving consumed or invalidated
authority. A changed or failed latest review invalidates unused whole-trip consent.
Finished review evidence, authorization terms and execution bases are immutable.

Owner-only `GET /trips/{tripId}/bookings` restores current coverage, bounded history,
attempts and commitments without supplier calls or mutations. The browser validates
shared public schemas, checks the actual clock, invalidates consent on trip changes
and retains request identities across uncertain retries. These customer contracts are
generated in `contracts/trip-domain/booking-review-v2.schema.json`.

**US3 is review/authorization only.** V2 starts create one durable, non-executing
attempt and pending outbox identity; all provider write activity entry points reject
v2 until US4 activation. No supplier confirmation, live payment readiness or approved
Nuitee checkout path is implied by deterministic fixtures.

## Write Result

Provider write activities return one normalized state:

- `confirmed`: provider evidence and reference are present;
- `failed`: provider definitively rejected the operation;
- `unknown`: request may have reached the provider but outcome is not established;
- `action_required`: provider or traveller action is needed.

Timeouts map to `unknown`. Activities query status before retrying an ambiguous write. A provider write is retried only with the identical supported idempotency key and request fingerprint.

## Idempotency

- Transaction key: stable digest of user, trip version, authorization snapshot hash, and operation.
- Component key: transaction key plus immutable component identity.
- PostgreSQL uniqueness prevents reuse for another request fingerprint.
- Temporal replay and repeated API calls return the recorded outcome when the key is complete.
- Every write checks the transaction's immutable execution basis, expiry, provenance of status-only version advances, and durable write claim. Material edits cannot commit while an affected claim is in flight or unknown; reconciliation resolves claims before new writes or edits.
- Providers lacking safe write idempotency use one attempt followed by status reconciliation or manual action; they are never retried blindly.

## Partial Failure and Recovery

Components record outcomes independently. Confirmed components remain confirmed when another component fails. Recovery can query status, retry a definitively failed eligible component under current authorization, request fresh authorization, or initiate an authorized cancellation. Automatic compensation is prohibited unless the traveller authorized it and the provider confirms reversibility and terms.

## Adapter Requirements

Each adapter declares supported component types, searchable fields, deadline behavior, idempotency support, status-query capability, cancellation/rescheduling capability, rate-limit behavior, and mapping tests. Deterministic test doubles must cover success, changed terms, unavailability, timeout-after-commit, duplicate request, contradictory callback, and partial failure.
