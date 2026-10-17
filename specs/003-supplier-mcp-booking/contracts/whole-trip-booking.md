# Whole-trip booking contract

Extend the current booking routes/domain/Temporal workflow. No new checkout, orchestrator, transaction MCP surface or component-selection booking API.

## Read/review

Add owner-scoped `GET /api/v1/trips/{tripId}/bookings` to the existing POST route. Use the current account/booking actor, trip lock/access rules and safe projection. Return current trip version, current complete coverage report, active/latest whole-trip attempt and continuation history, confirmed commitments and safe per-component outcomes; bound/paginate history. It must restore a durable attempt on reload before offering a new authorization. The accepted trip remains available if supplier reads fail.

Existing `POST /api/v1/trips/{tripId}/booking/revalidations` keeps `{requestId: UUID, expectedVersion: positive integer}` and adds optional `continuationOf: UUID`. No component list is accepted. The server derives the full required set/confirmed commitments and complete unresolved write set. Validate parent ownership/trip/root, reconcile every potentially dispatched predecessor first, and block continuation while uncertainty remains. Missing requirements return a report with actionable blockers, not partial bookable terms.

Use the current durable revalidation record/outbox/workflow and `GET /api/v1/booking/revalidations/{workflowId}`. Return run status, coverage, one outcome for every required unbooked component, safe complete v2 review terms/hash/expiry only if eligible, and blockers otherwise. Provider exceptions mean unknown, not definitive unavailability. Readiness/eligibility failures cannot become a generic traveller acknowledgement.

V2 review contains the full trip, including existing confirmations, but only to-book amounts contribute to `totalPrice` for this authorization. Show the new payable total, prior commitments and full-trip customer summary distinctly. Unknown costs, fee inclusion, unsupported conversion, missing actual service terms or identity/payment prerequisites block eligibility. Revalidation is strictly side-effect-free; no holds or reservations.

## Authorization and start

Keep `POST /api/v1/trips/{tripId}/booking/authorizations` and existing strict request:

| Field | Whole-trip value/constraint |
| --- | --- |
| requestId | Persistent UUID reused on network retry |
| tripVersion | Exact reviewed current version |
| termsHash | Server-generated complete v2 hash |
| operation | `book_trip` |
| componentId | `null` |
| acknowledgedNonReversibleActions | Exactly the required to-book IDs; explicit traveller review |

The server loads immutable persisted review, recomputes current coverage/readiness and compares the exact unresolved required set. Owner, version, all components, provider/offer/inventory, party/dates, material terms, exact currency/total, commitments, expiry and non-reversible conditions bind the authorization. Neither chat nor finalization/proposal approval is consent. Requests do not accept substitute client terms or a subset. Reuse existing idempotency repository for authorization creation; altered reuse conflicts, identical reuse returns the receipt. Parallel distinct authorizations do not bypass component write guards.

Keep `POST /api/v1/trips/{tripId}/bookings` with `{requestId, authorizationId}`. It consumes a current v2 authorization atomically, checks exact set equality and creates/replays the existing transaction/outbox/workflow. Do not use the current `bookingStatus === unbooked` filter as completeness or continuation logic. Failed/pending snapshot states must be resolved using durable attempt evidence, not interpreted as fresh inventory.

The UI presents one explicit action to authorize and start the whole trip. Existing separate HTTP authorization/start calls are implementation steps, not separate component purchasing decisions. A lost start response is replayed using the same IDs/authorization. Changing any bound fact requires new review/authorization, never a silent replacement.

V1 terms remain readable/hash-verifiable with their original parser. After activation, v1 cannot begin a new write; pending legacy execution stops for fresh review. Status reconciliation remains possible. Keep existing exact-action cancellation/rescheduling routes separately authorized and out of MCP.

## Dispatch and outcome invariants

Use current `bookTrip`, activities, repository, outbox and durable claims. Resolve adapters by preserved canonical provider provenance plus verified component capability, never type alone. A transfer is not implicitly supported by Booking.com.

Before each dispatch, under existing lock order, verify authorization basis/version or proven same-attempt status advances, expiry, coverage, operation readiness, trusted prerequisite references, and durable component/requirement guard. Persist the fixed request fingerprint and claim before the call. Block incompatible edits/claims while dispatched or unknown. Calls happen outside database transactions and transaction credentials are injected only into the trusted worker.

| Outcome | Required evidence and behavior |
| --- | --- |
| confirmed | Valid provider reference/evidence and established actual terms; durably preserve commitment |
| failed | Definitive rejection/non-commit evidence, not timeout or missing response |
| unknown | Possible commit; retain claim and stop further writes pending status |
| action_required | Changed/contradictory evidence or manual/provider action; retain relevant guards |
| not_attempted | No dispatched attempt after stop/block; never imply supplier rejection |

Atomically record resolved attempt/evidence/confirmation and duplicate guard before releasing a claim. Project safe status to trip versions through the current commit boundary when compatible. If the trip changed or execution expired/invalidated, authenticated provider truth must still reach durable owner-visible attempt results; mark projection/recovery action required instead of dropping it or overwriting unrelated trip changes. Confirmed-but-materially-different evidence stops remaining writes, preserves the reported commitment and requires manual/review resolution; it cannot be relabelled a harmless failed booking.

Check/reconcile a possibly committed write before any retry. If status is unsupported or inconclusive, retain uncertainty and provide support guidance. Time elapsed, a new authorization or a new key is not non-commit evidence. No-idempotency providers get at most one unresolved write. Provider-supported retry uses identical fingerprint/key as permitted; a new eligible action after definitive non-commit requires current full-trip review and fresh authorization. Cross-attempt guards prevent duplicate commitments during that transition.

Callbacks retain existing provider authentication, deduplication and evidence-conflict handling. They update truth even after write authority expires; they cannot authorize new execution.

## Continuation and UI contract

Continuation reuses revalidation/authorization/start with server-bound parent/root references. Full review includes every current requirement/commitment, while the to-book set is exactly all eligible unresolved required work. Already confirmed items are not revalidated as unbooked offers, recharged, rebooked or silently cancelled. Parent/child attempts remain one visible recovery history; repeated/competing continuation requests cannot duplicate work. Existing component status-check route remains read-only; no component retry/checkout is added.

Booking page must show meaningful names/provider/property/service labels, route/dates/party, estimates versus current amounts, taxes/fees/terms/expiry, all blockers, partial execution warning, non-reversible acknowledgements and one full-trip authorization. During recovery show confirmed/failed/uncertain/not-attempted and remaining payable amount, status check, return-to-planning/support and complete continuation where eligible. Use current-time expiry, server response validation and trip events; do not rely on polling-updated reviewedAt. Preserve keyboard operation, focus/error announcement and 320px usability.

## Contract acceptance

Extend current booking contract/integration/e2e suites: missing leg/stay, partial terms, false eligibility, altered provider/offer/party/baggage/refund/non-reversibility, mixed currency, subset tampering, authorization replay, separate-authorizations concurrency, expiry/edit between writes, no-idempotency timeout-after-commit, crash before local confirmation/projection, truth after invalidation/expiry, contradictory status/callback, confirmed-but-changed evidence, full continuation from failed/pending states, duplicate continuation, durable reload and assistive technology. All tests inspect provider writes and durable owner-visible outcomes, not private call sequences.
