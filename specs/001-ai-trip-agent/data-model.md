# Data Model: AI Trip Planning Agent

**Date**: 2026-10-09  
**Feature**: [AI Trip Planning Agent](./spec.md)  
**Research**: [Phase 0 decisions](./research.md)

## Ownership and Consistency Boundary

The `web/` domain layer is the sole owner of all application records and authoritative trip mutations. The `agent/` service reads bounded projections and emits proposals through versioned contracts; it has no database credentials for application tables. PostgreSQL transactions enforce aggregate changes, optimistic versions, booking authorization, idempotency, and outbox publication.

The current trip is identified by `Trip.currentVersion`. Every accepted draft change creates an immutable `TripVersion`; conversation messages and summaries can explain intent but never replace that state.

## Core Entities

### User

Customer identity owned by Better Auth.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary identity referenced by owned records |
| `locale` | locale code | Controls customer-facing formatting only |
| `defaultCurrency` | ISO 4217 code | May be overridden per trip |

Sensitive identity and payment details are not copied into trip snapshots unless required for a specific authorized transaction.

### Trip

Stable identity and current lifecycle pointer for one holiday plan.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Immutable |
| `ownerUserId` | UUID | Required; authorization boundary |
| `title` | string | 1-120 characters |
| `lifecycleState` | enum | `draft`, `finalized`, `partially_booked`, `booked`, `cancelled` |
| `currentVersion` | positive integer | Monotonically increases on each accepted mutation |
| `currency` | ISO 4217 code | One presentation currency per version |
| `createdAt`, `updatedAt` | timestamp | UTC |
| `lastActivityAt` | timestamp | Drives retention review |

**Relationships**: has many `TripVersion`, `Conversation`, `AgentRun`, `ChangeProposal`, `BookingAuthorization`, and `BookingTransaction` records.

### TripVersion

Immutable, complete, validated snapshot of the trip aggregate.

| Field | Type | Rules |
|---|---|---|
| `tripId` | UUID | Part of composite key |
| `version` | positive integer | Part of composite key; previous + 1 |
| `previousVersion` | integer or null | Null only for initial version |
| `schemaVersion` | positive integer | Enables compatible snapshot evolution |
| `snapshot` | TripSnapshot | Complete aggregate described below |
| `initiatingActor` | enum + identifier | `user`, `agent_proposal`, `system_revalidation`, `booking_workflow` |
| `initiatingRequestId` | UUID | Correlation and replay protection |
| `proposalId` | UUID or null | Required for proposal-initiated changes |
| `changeSummary` | structured list | Material fields and components affected |
| `inverseOperation` | structured command or null | Null requires `nonReversibleReason` |
| `nonReversibleReason` | string or null | Required when no inverse exists |
| `createdAt` | timestamp | UTC, immutable |

A database transaction inserts the candidate version and advances `Trip.currentVersion` only when it still equals the command's `expectedVersion`. No historical row is updated or deleted. Undo creates a new version from a prior snapshot.

### TripSnapshot

Root value object contained in each `TripVersion`.

| Field | Type | Rules |
|---|---|---|
| `departureOrigin` | DepartureOrigin | Required, resolved and traveller-confirmed before flight estimation |
| `availabilityWindows` | AvailabilityWindow[] | At least one before estimation |
| `duration` | DurationPreference | Must fit at least one availability window |
| `travellerParty` | TravellerParty | At least one adult for initial scope |
| `preferences` | PreferenceProfile | All five dimensions present |
| `constraints` | TripConstraint[] | Reviewable and source-attributed |
| `destinations` | Destination[] | 1-8, unique ordered positions |
| `itineraryDays` | ItineraryDay[] | Unique date within the trip |
| `components` | TravelComponent[] | Maximum 32 |
| `price` | TripPrice | Currency-consistent totals |
| `warnings` | TripWarning[] | Unresolved material conflicts visible |

### DepartureOrigin

| Field | Type | Rules |
|---|---|---|
| `kind` | enum | `city` or `airport` |
| `placeId` | opaque place identity | Required; disambiguated within country |
| `name` | string | 1-120 characters |
| `countryCode` | ISO 3166-1 alpha-2 code | Required |
| `timezone` | IANA timezone | Required and valid |
| `airportCode` | IATA code or null | Three uppercase letters for airport; null for city |
| `confirmedByUser` | boolean | Must be true before flight estimation |

Return travel defaults to this origin. City-level searches may consider its airports but must disclose the proposed airport; a different city requires an accepted origin change. Never infer origin from IP or identity. Legacy snapshots missing origin remain readable under their prior schemaVersion; upgrading them requires explicit origin confirmation before new flight estimates and never fabricates a value.

### AvailabilityWindow

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Stable within trip |
| `startDate`, `endDate` | local date | Inclusive; end is not before start |
| `preference` | enum | `preferred` or `flexible` |
| `timezone` | IANA timezone | Used for date boundaries |

Windows may overlap but are normalized for optimization. Flexible dates never replace preferred dates without an accepted proposal.

### DurationPreference

| Field | Type | Rules |
|---|---|---|
| `minimumDays` | integer | At least 1 |
| `idealDays` | integer | `minimumDays <= idealDays` |
| `maximumDays` | integer | `idealDays <= maximumDays`; fits an availability window |

A recommendation outside the ideal duration records a material benefit in its proposal rationale.

### TravellerParty

| Field | Type | Rules |
|---|---|---|
| `adults` | integer | 1-10 |
| `children` | ChildTraveller[] | Total party size no more than 10 |

`ChildTraveller` contains a stable trip-local ID and age at trip start. Names, passport details, and payment information are not part of draft trip snapshots.

### PreferenceProfile

Each dimension is an integer from 0 to 100 with 50 neutral:

- `pace`: relaxed to packed
- `spend`: budget to luxury
- `discovery`: touristy to authentic
- `independence`: independent to organized
- `setting`: cities to nature

### TripConstraint

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Stable within trip |
| `category` | enum | accessibility, dietary, schedule, lodging, budget, occasion, transport, other |
| `statement` | string | Traveller-reviewable wording |
| `priority` | enum | `required`, `strong`, `preference` |
| `source` | enum + reference | setup text, direct edit, conversation message, system inference |
| `status` | enum | `active`, `conflicting`, `unverified`, `removed` |
| `confirmedByUser` | boolean | Required for material inferred constraints before booking |

### Destination

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Stable within trip |
| `kind` | enum | `country`, `city`, `place` |
| `name`, `countryCode` | string | Human-readable and ISO country identity |
| `providerPlaceIds` | map | Optional source identifiers |
| `location` | geography point | SRID 4326 when known |
| `routePosition` | integer | Unique contiguous order |
| `arrivalDate`, `departureDate` | local date or null | Ordered and within trip window when scheduled |
| `plannedNights` | integer | Non-negative and consistent with dates |

### ItineraryDay and ItineraryItem

`ItineraryDay` has a unique trip-local date, destination reference, timezone, pace assessment, and ordered `ItineraryItem` values.

An `ItineraryItem` contains type (`activity`, `meal`, `free_time`, `travel`, `note`), local start/end, location, component reference when bookable, constraint checks, and status (`proposed`, `planned`, `confirmed`, `cancelled`). Travel items also reference a `TravelSegment`.

### TravelSegment

Contains mode (`walk`, `public_transport`, `drive`, `flight`, `rail`, `transfer`, `ferry`, `other`), origin and destination, planned departure/arrival, duration, route geometry, directions summary, source, and freshness timestamp. Times must be ordered and timezone-qualified. Record the duration upper bound where supplied, timing evidence, verification status, and feasibilityPolicyVersion. Apply spec.md's feasibility policy v1; missing evidence cannot produce a verified pass.

### TravelComponent

Discriminated aggregate member for `flight`, `accommodation`, `activity`, `rail`, or `transfer`.

Common fields include stable component ID, itinerary references, provider, supplier offer ID, offer status, service dates/times, traveller eligibility, booking requirements, cancellation terms, `ComponentPrice`, freshness/expiry, and booking status. Type-specific details carry flight legs and baggage, stay occupancy and amenities, activity duration/directions, or transport stations and route details.

### Money and Pricing

`Money` uses an ISO currency and integer minor units. Floating-point monetary values are prohibited.

`ComponentPrice` contains supplier amount, platform margin, taxes, fees, final customer amount, price status (`estimated`, `quoted`, `live`, `expired`, `confirmed`), source, and checked/expiry timestamps. The invariant is:

`finalCustomer = supplier + platformMargin + customerPayableTaxes + customerPayableFees`

`TripPrice` totals components in one presentation currency and records conversion disclosures. Customer production projections omit supplier amount and platform margin; internal authorized projections retain them.

## Conversation and Agent Entities

### Conversation and Message

A trip may have one or more conversations. Each `Message` records role, typed/redacted content, creation time, related trip version, agent run, and retention expiry. Raw conversation is retained for 90 days by default; deletion preserves required transaction and structured trip records.

### ConversationSummary

Versioned summary with `constraints`, `preferences`, `decisions`, `rejectedOptions`, `openQuestions`, covered message range, source trip version, token estimate, and creation time. Summary facts cannot override the current trip version.

### AgentRun

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Used for status and event replay |
| `tripId`, `conversationId` | UUID | Required and authorized |
| `baseTripVersion` | integer | Proposal concurrency basis |
| `requestId` | UUID | Idempotency/correlation |
| `status` | enum | `queued`, `running`, `awaiting_clarification`, `proposed`, `completed`, `failed`, `cancelled` |
| `eventCursor` | integer | Monotonic replay position |
| `startedAt`, `completedAt` | timestamp | UTC |
| `errorCategory` | safe enum or null | No raw sensitive error payload |
| `leaseExpiresAt` | UTC timestamp or null | 90-second queued/running lease renewed by durable progress every 15 seconds; suspended while awaiting clarification |

### ChangeProposal

| Field | Type | Rules |
|---|---|---|
| `id`, `tripId`, `agentRunId` | UUID | Required |
| `baseTripVersion` | integer | Must equal current version at apply time |
| `purpose` | enum | `initial_estimate`, `refinement`, `finalization` |
| `initiatingRequestId` | UUID | Required; must match the scoped run request |
| `operations` | typed operation[] | Allowlisted draft-only operations |
| `affectedFacts` | structured paths/IDs | Required for impact review |
| `rationale`, `tradeoffs` | string/list | Traveller-facing |
| `priceImpact`, `scheduleImpact` | structured delta | Required when affected |
| `ambiguities`, `warnings` | list | Material uncertainty surfaced |
| `status` | enum | State machine below |
| `createdAt`, `expiresAt` | timestamp | Stale proposals cannot apply |

Permitted operations include departure origin, destination, date, duration, traveller, preference, constraint, itinerary-item, and draft-component changes. Booking, payment, cancellation, and rescheduling operations are not valid proposal operations. Initial estimates use the same proposal/acceptance machinery in US1; the agent supplies draft operations and rationale, while web resolves trusted offer facts and recomputes price/impacts. No top-level price write is a valid operation. Requesting research never implies proposal acceptance.

## Transactional Booking Entities

### BookingAuthorization

Immutable authorization bound to exact revalidated terms.

| Field | Type | Rules |
|---|---|---|
| `id`, `tripId`, `userId` | UUID | Required |
| `tripVersion` | integer | Must match current version at execution start and before the first provider write |
| `termsSnapshot` | canonical structured data | Exact components, travellers, dates, prices, taxes, terms, currency, expiry |
| `termsHash` | cryptographic digest | Computed from canonical snapshot |
| `status` | enum | `pending`, `authorized`, `invalidated`, `expired`, `consumed` |
| `authorizedAt`, `expiresAt` | timestamp | Execution must occur in window |
| `invalidatedReason` | enum or null | Material change reason |

Authorization is invalidated by material changes to price, dates, travellers, departure origin, inventory, components, or cancellation terms. Starting execution consumes the one-shot authorization into an immutable transaction-owned execution basis; consumption never grants permission to use changed or expired terms.

### BookingTransaction

| Field | Type | Rules |
|---|---|---|
| `id`, `tripId`, `authorizationId` | UUID | Required |
| `operation` | enum | `book_trip`, `reschedule_component`, `cancel_component` |
| `idempotencyKey` | string | Globally unique for operation and terms hash |
| `workflowId` | string | Unique Temporal workflow identity |
| `executionBasis` | immutable value | Authorized user, operation, authorization ID, starting tripVersion, canonical terms snapshot/hash and expiry |
| `lastObservedTripVersion` | positive integer | Mutable execution checkpoint; advances only through proven same-transaction status/evidence versions |
| `executionStatus` | enum | `active`, `invalidated`, `expired`, `completed` |
| `status` | enum | State machine below |
| `startedAt`, `completedAt` | timestamp | UTC |
| `requestedBy` | UUID | Authorized actor |

The initial execution basis is claimed with the authorization and idempotency record in one database transaction. Its original authorization is consumed once; later material changes invalidate executionStatus rather than rewriting that authorization. Before every provider write, compare current version and material terms against the basis. Later version advances are allowed only if every intervening version identifies this transaction and changes only status, lifecycle or evidence fields. Canonical material terms exclude those status/evidence fields, but retain exact offer/inventory IDs, departure origin, dates, travellers, amounts/currency, cancellation conditions and other authorized terms. A provider confirmation with changed material facts invalidates execution and stops pending writes. Any external version advance requires renewed authorization; it is never silently merged. A short database transaction serializes the durable provider-write claim with trip-edit acceptance; affected material edits are rejected while a claim is in flight or unknown. Do not hold a database transaction across a provider network call. Reconciliation resolves the claim, and earlier successful confirmations remain durable.

### BookingComponentAttempt

One record per component and attempt, with transaction/component/provider identity, provider idempotency key, state, attempt number, request fingerprint, safe outcome, provider reference when confirmed, retry/status-check times, and failure category. A uniqueness constraint prevents a component idempotency key from invoking the provider twice.

### BookingConfirmation

Immutable confirmed outcome containing component, provider booking reference, final terms, final customer price, cancellation/rescheduling rules, traveller-facing instructions, and confirmation timestamp. It never stores payment secrets.

## Delivery and Audit Entities

### OutboxEvent

Committed in the same transaction as its aggregate change. Contains event ID/type/version, aggregate identity/version, redacted payload, creation time, delivery state, attempt count, and next-attempt time. Consumers must be idempotent.

### IdempotencyRecord

Used at retried command, provider-write, and callback boundaries. Contains scope, key, request fingerprint, state (`in_progress`, `completed`, `unknown`), stored result reference, and expiry. A reused key with a different fingerprint is rejected.

### AuditEvent

Append-only evidence for authentication-sensitive, authorization, booking, administrative, and data-export/deletion actions. Stores actor, action, target, request/trace identity, outcome, timestamp, and allowlisted metadata only.

## State Transitions

### Change Proposal

```text
proposed -> needs_clarification -> proposed
proposed -> accepted -> applied
proposed -> rejected
proposed -> stale
accepted -> stale (version changed before apply)
```

Only the web domain can move `accepted` to `applied`, after validation and an optimistic version check. This rule includes initial-estimate proposals; their model/repository/basic acceptance endpoint exists in US1, before US2 extends refinement/history.

### Offer and Price

```text
estimated -> quoted -> revalidating -> live -> confirmed
estimated|quoted|live -> expired
revalidating -> unavailable
```

Only `live` unexpired terms can enter an authorization snapshot. `confirmed` requires a provider confirmation.

### Booking Authorization

```text
pending -> authorized -> consumed
pending|authorized -> invalidated
pending|authorized -> expired
```

Material term changes force `invalidated`; they never update an existing snapshot.

### Booking Transaction

```text
requested -> running -> confirmed
requested -> cancelled
running -> partially_confirmed
running|partially_confirmed -> action_required
running -> failed
partially_confirmed|action_required -> confirmed|failed|cancelled
```

### Booking Component

```text
proposed -> authorized -> booking -> confirmed
booking -> failed
booking -> unknown -> confirmed|failed|action_required
confirmed -> cancelled
confirmed -> action_required (post-booking provider issue)
```

A timeout produces `unknown`, not an inferred success or failure. Cancellation and rescheduling require their own authorized transaction.

## Cross-Entity Invariants

1. Only one `TripVersion` matches `Trip.currentVersion`; every pane renders that version.
2. A proposal applies only to its exact `baseTripVersion` and cannot contain transactional operations.
3. Scheduled dates fit a declared availability window and duration bounds unless an accepted proposal records the stated deviation benefit.
4. Itinerary items cannot overlap impossibly after accounting for travel and transition time; unresolved hard conflicts block finalization.
5. Customer projections never contain supplier amount or platform margin.
6. Authorization terms hash, trip version, user, and expiry must match at workflow start and before the first provider write. Every later write checks the immutable execution basis and only accepts proven same-transaction status/evidence version advances; changed terms, expiry, external edits or an unresolved competing write stop dispatch.
7. Confirmed status always has provider evidence; uncertain outcomes remain `unknown` or `action_required`.
8. Conversation, summaries, retrieved context, and model output cannot mutate authoritative state directly.
9. Sensitive traveller/payment values do not enter prompts, general logs, traces, or fixtures.
10. Schema changes to snapshots, commands, and events carry versions and compatibility handling.
