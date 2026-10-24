# Whole-trip booking contract

Extend the current booking routes/domain/Temporal workflow. No new checkout, orchestrator, transaction MCP surface or component-selection booking API.

## Implemented review-only boundary (US3)

US3 implements complete v2 coverage/review, exact owner-scoped authorization,
replay-safe non-executing start records and durable browser restoration. The shared
customer schemas are generated in `contracts/trip-domain/booking-review-v2.schema.json`.
The original v1 parser/hash and historical reconciliation/separate change flows remain.
Latest review means request creation order, not an older worker's completion time.
Completed/failed review records and authorization request identity are immutable.
Fresh changed or failed reviews invalidate unused whole-trip consent under the trip lock.

Production composition has no approved side-effect-free final-term reader or trusted
traveller/payment source. Missing sources remain blockers. Optional server-only
classification evidence can establish a free/self-arranged item; proposal metadata
cannot. Reads, including readiness resolution, have bounded deadlines; expiry is
rechecked after those reads and before recording authorization or start.

V2 provider execution is explicitly refused by basis, claim and dispatch activities.
The start record is inactive with no dispatched component attempts; its durable outbox
identity remains pending rather than being falsely marked delivered. The US4 additions
below implement recovery review/lineage without activating consequential provider writes.

## Implemented US4 transaction-safety boundary

Migration 016 extends existing attempts with immutable requirement identities,
append-only sanitized provider evidence and a monotonic conflict flag. Claims bind
the exact trip/transaction/component/attempt. Parent/root lineage must belong to
the same account and trip. Repository checks reject confirmed or outstanding
component/requirement commitments even with a different authorization/key.

The existing execution activities now claim and dispatch under the access/trip,
transaction and attempt/claim locks. A durable claimed-to-dispatched compare-and-set
has one winner; provider calls occur outside transactions. A stopped claim can be
released only when durable evidence proves dispatch never happened. A dispatched
or unknown action cannot be reclaimed. Network exceptions remain unknown.

Provider evidence, actual valid confirmation terms/reference, component outcome,
compatible trip projection and resolved-claim release commit together. Database
errors after provider success propagate rather than being recast as supplier
failure. Status/callback ingestion does not require active execution authority.
Changed confirmations remain commitments requiring support; conflicting evidence
is retained without replacing the original reference. Incompatible trip versions
or competing claims prevent projection, not durable truth recording.

Status capability is independent of fresh booking capability. Existing historical
confirmations without an attempt can acquire a reconciliation-only evidence record;
this does not grant a new write. The existing authenticated callback bridge remains
limited to its documented providers; no Nuitee/Viator webhook authentication is
invented. Unsupported or uncorrelated status requires manual support.

Whole-trip recovery review derives the current parent and original root from durable
history under the trip lock. Outstanding claims, dispatched/unknown attempts,
conflicting evidence and active unexpired execution block another review/authorization.
Authorization and start recheck that lineage; two separately granted authorizations
cannot create competing children of the same parent. The current leaf is restored
even when parent/child start timestamps are identical.

Confirmed commitments must remain in the full review, with unchanged actual service,
traveller, money, included-charge and cancellation/non-reversibility terms. They are
never revalidated as new offers, added to the remaining amount or included in child
writes. A definitive non-commit remains `failed` in attempt history but projects
`unbooked`, not `pending`, so fresh whole-trip review is possible. Uncertainty retains
its guard and never receives that treatment.

Migration 017 preserves trip-version event uniqueness while identifying booking
outbox events by their required workflow identity. A fresh review/continuation can
persist at the same trip version without suppressing a durable workflow intent.

These are recovery-review/persistence changes, not completion of US4. V2 basis,
claim and dispatch remain explicitly disabled. Restricted supplier HTTP mappings,
trusted dispatch prerequisites, stock-worker composition, the >=100-distinct-case
execution matrix and full executing recovery browser certification must still
complete before activation. A 100-delivery dispatch regression is not 100 distinct
acceptance cases.

Current execution scope is Duffel flights, Nuitee accommodation and Viator activities. Resolve by immutable provider plus component type, never type-only accommodation defaults or relabelled Duffel stay IDs. Duffel uses its separate worker-only write key; Nuitee/Viator each use their shared upstream key in the trusted worker, with actual booking/payment entitlement and trusted prerequisites required independently. No fresh writes target Duffel Stays, Nuitee Flights/Experiences, deferred Booking.com/Trainline or replaced GetYourGuide. Preserve legacy attribution, commitments and existing approved status reconciliation without requiring inactive onboarding.

A complete supported flight/stay/activity trip must not depend on rail data or inactive-provider access. A genuinely required unresolved rail leg still blocks the entire attempt; deferral is not a completeness waiver. Nuitee selected multi-room offers must establish occupancy, mandatory included/excluded costs, final terms and payment timing; unknown costs or unsupported payment schedules cannot be omitted from exact review. Prebook is not a safe read merely because `usePaymentSdk=false`: until approved no-hold/no-reservation/no-payment semantics establish an eligible variant, revalidation is unsupported and stay authorization is blocked. Fresh rates alone cannot be promoted to final checkout evidence. Never initialize payment, reserve inventory or accept changed terms to obtain a review under stale or absent authorization.

Approved worker-only prebook/book/status handling uses exact authorized offer/party/material terms, opaque trusted guest/payment references and durable possible-commit guards. A reusable `prebookId` is not a duplicate-prevention guarantee. Status must correlate the actual attempt; missing correlation after timeout retains uncertainty/manual support, not a blind retry. Payment success alone never means accommodation confirmation.

## Read/review

Add owner-scoped `GET /api/v1/trips/{tripId}/bookings` to the existing POST route. Use the current account/booking actor, trip lock/access rules and safe projection. Return current trip version, current complete coverage report, active/latest whole-trip attempt and continuation history, confirmed commitments and safe per-component outcomes; bound/paginate history. It must restore a durable attempt on reload before offering a new authorization. The accepted trip remains available if supplier reads fail.

Existing `POST /api/v1/trips/{tripId}/booking/revalidations` keeps the strict
`{requestId: UUID, expectedVersion: positive integer}` request. No component list or
client-selected parent/root is accepted: the server derives current lineage, the full
required set/confirmed commitments and complete unresolved write set. Validate parent
ownership/trip/root, reconcile every potentially dispatched predecessor first, and block
continuation while uncertainty remains. Missing requirements return a report with
actionable blockers, not partial bookable terms.

Use the current durable revalidation record/outbox/workflow and `GET /api/v1/booking/revalidations/{workflowId}`. Return run status, coverage, one outcome for every required unbooked component, safe complete v2 review terms/hash/expiry only if eligible, and blockers otherwise. Provider exceptions mean unknown, not definitive unavailability. Readiness/eligibility failures cannot become a generic traveller acknowledgement.

V2 review contains the full trip, including existing confirmations, but only to-book amounts contribute to `totalPrice` for this authorization. Show the new payable total, prior commitments and full-trip customer summary distinctly. Unknown costs, fee inclusion, unsupported conversion, missing actual service terms or identity/payment prerequisites block eligibility. Revalidation is strictly side-effect-free; no holds or reservations.

## Authorization and start

Keep `POST /api/v1/trips/{tripId}/booking/authorizations` and existing strict request:

| Field                            | Whole-trip value/constraint                                 |
| -------------------------------- | ----------------------------------------------------------- |
| requestId                        | Persistent UUID reused on network retry                     |
| tripVersion                      | Exact reviewed current version                              |
| termsHash                        | Server-generated complete v2 hash                           |
| operation                        | `book_trip`                                                 |
| componentId                      | `null`                                                      |
| acknowledgedNonReversibleActions | Exactly the required to-book IDs; explicit traveller review |

The server loads immutable persisted review, recomputes current coverage/readiness and compares the exact unresolved required set. Owner, version, all components, provider/offer/inventory, party/dates, material terms, exact currency/total, commitments, expiry and non-reversible conditions bind the authorization. Neither chat nor finalization/proposal approval is consent. Requests do not accept substitute client terms or a subset. Reuse existing idempotency repository for authorization creation; altered reuse conflicts, identical reuse returns the receipt. Parallel distinct authorizations do not bypass component write guards.

Keep `POST /api/v1/trips/{tripId}/bookings` with `{requestId, authorizationId}`. It consumes a current v2 authorization atomically, checks exact set equality and creates/replays the existing transaction/outbox/workflow. Do not use the current `bookingStatus === unbooked` filter as completeness or continuation logic. Failed/pending snapshot states must be resolved using durable attempt evidence, not interpreted as fresh inventory.

The UI presents one explicit action to authorize and start the whole trip. Existing separate HTTP authorization/start calls are implementation steps, not separate component purchasing decisions. A lost start response is replayed using the same IDs/authorization. Changing any bound fact requires new review/authorization, never a silent replacement.

V1 terms remain readable/hash-verifiable with their original parser. After activation, v1 cannot begin a new write; pending legacy execution stops for fresh review. Status reconciliation remains possible. Keep existing exact-action cancellation/rescheduling routes separately authorized and out of MCP.

## Dispatch and outcome invariants

Use current `bookTrip`, activities, repository, outbox and durable claims. Resolve adapters by preserved canonical provider provenance plus verified component capability, never type alone. A transfer is not implicitly supported by Booking.com.

Before each dispatch, under existing lock order, verify authorization basis/version or proven same-attempt status advances, expiry, coverage, operation readiness, trusted prerequisite references, and durable component/requirement guard. Persist the fixed request fingerprint and claim before the call. Block incompatible edits/claims while dispatched or unknown. Calls happen outside database transactions and transaction credentials are injected only into the trusted worker.

| Outcome         | Required evidence and behavior                                                              |
| --------------- | ------------------------------------------------------------------------------------------- |
| confirmed       | Valid provider reference/evidence and established actual terms; durably preserve commitment |
| failed          | Definitive rejection/non-commit evidence, not timeout or missing response                   |
| unknown         | Possible commit; retain claim and stop further writes pending status                        |
| action_required | Changed/contradictory evidence or manual/provider action; retain relevant guards            |
| not_attempted   | No dispatched attempt after stop/block; never imply supplier rejection                      |

Atomically record resolved attempt/evidence/confirmation and duplicate guard before releasing a claim. Project safe status to trip versions through the current commit boundary when compatible. If the trip changed or execution expired/invalidated, authenticated provider truth must still reach durable owner-visible attempt results; mark projection/recovery action required instead of dropping it or overwriting unrelated trip changes. Confirmed-but-materially-different evidence stops remaining writes, preserves the reported commitment and requires manual/review resolution; it cannot be relabelled a harmless failed booking.

Check/reconcile a possibly committed write before any retry. If status is unsupported or inconclusive, retain uncertainty and provide support guidance. Time elapsed, a new authorization or a new key is not non-commit evidence. No-idempotency providers get at most one unresolved write. Provider-supported retry uses identical fingerprint/key as permitted; a new eligible action after definitive non-commit requires current full-trip review and fresh authorization. Cross-attempt guards prevent duplicate commitments during that transition.

Callbacks retain existing provider authentication, deduplication and evidence-conflict handling. They update truth even after write authority expires; they cannot authorize new execution.

## Continuation and UI contract

Continuation reuses revalidation/authorization/start with server-bound parent/root references. Full review includes every current requirement/commitment, while the to-book set is exactly all eligible unresolved required work. Already confirmed items are not revalidated as unbooked offers, recharged, rebooked or silently cancelled. Parent/child attempts remain one visible recovery history; repeated/competing continuation requests cannot duplicate work. Existing component status-check route remains read-only; no component retry/checkout is added.

Booking page must show meaningful names/provider/property/service labels, route/dates/party, estimates versus current amounts, taxes/fees/terms/expiry, all blockers, partial execution warning, non-reversible acknowledgements and one full-trip authorization. During recovery show confirmed/failed/uncertain/not-attempted and remaining payable amount, status check, return-to-planning/support and complete continuation where eligible. Use current-time expiry, server response validation and trip events; do not rely on polling-updated reviewedAt. Preserve keyboard operation, focus/error announcement and 320px usability.

## Contract acceptance

Extend current booking contract/integration/e2e suites: missing leg/stay, partial terms, false eligibility, altered provider/offer/party/baggage/refund/non-reversibility, mixed currency, subset tampering, authorization replay, separate-authorizations concurrency, expiry/edit between writes, no-idempotency timeout-after-commit, crash before local confirmation/projection, truth after invalidation/expiry, contradictory status/callback, confirmed-but-changed evidence, full continuation from failed/pending states, duplicate continuation, durable reload and assistive technology. All tests inspect provider writes and durable owner-visible outcomes, not private call sequences.
