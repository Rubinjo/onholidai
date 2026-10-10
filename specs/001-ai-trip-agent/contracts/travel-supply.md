# Travel Supply Contract

The first-party `travel-supply` boundary normalizes provider behavior across Duffel flights, Booking.com Demand accommodation, GetYourGuide activities, and Trainline rail. Adapter-specific payloads remain behind this boundary.

## Capability Separation

### Read Interface

Callable by planning services and approved agent MCP adapters:

- `searchOffers(criteria, deadline)` returns normalized estimated or quoted offers with source and freshness.
- `getOffer(offerId)` returns current known details without changing provider state.
- `revalidateOffers(offerIds, travellers, dates)` returns immutable live terms or explicit changed/unavailable outcomes.
- `getBookingStatus(providerReference)` performs a read-only reconciliation query.

Read calls cannot reserve inventory, incur a charge, cancel, or reschedule.

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

A canonical authorization snapshot may include only unexpired `unchanged` or traveller-accepted `changed` terms. The snapshot includes the exact normalized fields and a deterministic hash.

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
- Providers lacking safe write idempotency use one attempt followed by status reconciliation or manual action; they are never retried blindly.

## Partial Failure and Recovery

Components record outcomes independently. Confirmed components remain confirmed when another component fails. Recovery can query status, retry a definitively failed eligible component under current authorization, request fresh authorization, or initiate an authorized cancellation. Automatic compensation is prohibited unless the traveller authorized it and the provider confirms reversibility and terms.

## Adapter Requirements

Each adapter declares supported component types, searchable fields, deadline behavior, idempotency support, status-query capability, cancellation/rescheduling capability, rate-limit behavior, and mapping tests. Deterministic test doubles must cover success, changed terms, unavailability, timeout-after-commit, duplicate request, contradictory callback, and partial failure.
