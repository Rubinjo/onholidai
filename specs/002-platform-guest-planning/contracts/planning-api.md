# Planning API and Access Contract

All JSON mutations retain exact configured Origin, content-type and 262144-byte request limits. Private successes/errors/streams remain private,no-store. Credentials/digests are absent from bodies/URLs/logs. IDs are resource references, never proof. See [data model](../data-model.md).

## Actor resolution

PlanningActor is server-produced: guest has planningOwnerId plus validated guestSessionId; account has planningOwnerId plus validated accountUserId. Resolve resource principal and prove current binding. Linked principals need account authority. While an explicit pending link is being completed, original guest proof remains usable for that unlinked principal; an account session alone does not claim guest trips.

BookingActor requires Better Auth identity and principal linked to that account. Retain browserUser as registered-account behavior or rename explicitly; add dedicated planning resolution, never globally treat guests as registered users. Internal planning requires existing signed audience/scope/principal/trip/request/version plus current unrevoked run grant.

## Session bootstrap

POST /api/v1/planning-session body {requestId: UUID}: same-origin. Valid guest cookie renews idle expiry, returns 200 {kind:'guest',expiresAt}; missing/expired cookie creates fresh session with protected Set-Cookie and same shape, without recovering prior data. Account session returns 200 {kind:'account'}, no guest allocation. Failure must not claim successful initialization. Server pages read cookies; public builder bootstraps through client POST, not homepage. Visible entries edited during initialization stay unsaved until durable save succeeds.

## Drafts

- POST /api/v1/setup-drafts {requestId:UUID}: account or valid guest session. Allocate default partial payload, immutable creation/research IDs and a dedicated non-default principal linked to the current account or guest session. Creation receipt is scoped to account/session and request ID in existing idempotency storage; a replay still requires current resource authority before returning private data. Exact replay returns original rather than another principal/draft. Return 201 new/200 replay {draftId,revision,currentStep,payload,submittedTripId,updatedAt}.
- GET /api/v1/setup-drafts/{draftId}: owner-only 200 same envelope, unknown/inaccessible 404. draftId in builder query may identify recovery target but cannot authorize it.
- PATCH /api/v1/setup-drafts/{draftId} {requestId,expectedRevision,currentStep,payload}: strict partial schema, transactional owner/revision check, revision increment. Exact fingerprint replay returns original acknowledgment; conflicting key 409. Stale revision 409 draft_revision_conflict, currentRevision only to proven owner, no write. Submitted draft returns 409 draft_already_submitted and authorized trip-edit destination.
- POST /api/v1/setup-drafts/{draftId}/submit {expectedRevision}: server's immutable creation ID supplies duplicate prevention. Fully validate confirmed origin and domain facts, commit initial trip/association atomically. Return 201/200 replay {tripId,version,researchRequestId,nextPath}; nextPath derived /trips/{tripId}. Initial research reservation follows existing trip agent-run POST with persistent request ID; lost reservation response retries use the same trip/ID. Once a run is terminal failed or revoked, explicit research retry uses a fresh request/run UUID durably reserved before dispatch, retaining the original draft ID/receipt and same trip. Existing replay is checked before quota and cannot redispatch a revoked grant.
- Saved acknowledgment occurs only after commit. Save failure retains client input and unsaved status. Conflict reload/compare retains local edits, with no automatic merge.

## Places/globe

Keep GET /api/v1/places?query=... response {candidates:PlaceCandidate[],ambiguous:boolean} and schema. Add optional two-letter countryCode and kind country/city/airport/place filters; provider adapters/deterministic fixtures must enforce same semantics. Empty query allowed only for country-restricted city lookup. Bound query and candidate counts using existing lookup limits.

Resolve country clicks from canonical ISO/name geometry through lookup; offer country and resolved city candidates. Never infer identity/timezone from raw coordinates or choose city automatically. Multi-timezone ambiguity follows existing clarification policy. Globe city points come from resolved candidates or selected cities; ocean/unresolved clicks add nothing. Search/list offer equivalent operations. Lookup remains account-free with abuse bounds.

## Booking intents and linking

- POST /api/v1/booking-intents {requestId,tripId}: prove guest ownership and eligible booking capability. Create/replay 30-minute review_booking intent; return 201/200 {intentId,expiresAt,signInPath,signUpPath,returnToPlanningPath}. Already authorized account owner returns 200 {nextPath:'/trips/{tripId}/booking'} without claim.
- Sign-in/sign-up receive validated intentId and optionally existing safe local redirectTo for ordinary authentication. Intent takes precedence. Auth fields follow existing Better Auth policy; passwords/guest credentials never enter drafts/navigation.
- /auth/continue?intentId=... renders same-origin POST continuation with stable request UUID, pending/error/retry state. GET never links. Pending intent requires account plus original valid guest proof. Completed receipt replay requires same proven account even if cookie expired. Automatic post-auth form submission may link access, never financial actions.
- POST /api/v1/booking-intents/{intentId}/link {requestId}: account plus original guest proof for new claim. Lock/recheck relation; atomically bind principal/clear guest, increment draft revision, revoke old grants/interrupt active research, consume intent and append link/audit receipt. Return 200 {tripId,version,linked:true,replayed,nextPath}. Derive current eligible booking path; if eligibility changed, return authorized trip-planning path and reason finalization_required.
- Same-account retry resolves original; different account/wrong proof gets non-disclosing denial. Expired unused intent gives 410 booking_intent_expired only after original authority proof; recreate at boundary. Missing account 401 authentication_required. Cancelled/failed auth consumes nothing.
- No link/auth path calls booking authorization, transaction start, provider/payment client or accepts proposal.

## Permission matrix

| Route family | Authority / preserved boundary |
| --- | --- |
| /, /trips/new, /sign-in, /sign-up | Public; no planning registration gate. |
| Session bootstrap/drafts/places | Guest bootstrap then private draft owner; lookup accessible without registration, bounded. |
| Trip POST | Account default principal for legacy direct creation; guest through persisted draft submission. |
| Trip page/GET/versions/events | Current proven planning principal; replay/history/streams equally protected. |
| Trip agent-runs and run GET/events/clarifications | Planning principal across trip/run/conversation; quota before new guest request. |
| Conversations/proposal accept/reject | Planning principal, existing base-version/expiry/explicit acceptance. |
| edit-preview/edit/undo/finalize | Planning principal, existing impact/version/feasibility/write-exclusion. |
| Booking page/revalidation/authorization/start | Registered BookingActor, eligible lifecycle, live terms and separate exact consent. |
| Booking/revalidation status; recovery/cancel/reschedule | Registered account owns booking and related principal; separate component authorizations remain. |
| Internal agent-view/search/context/proposal/run persistence | Existing service token plus unrevoked run grant/current principal; transactional checks/receipts. |
| Internal pricing/provider callbacks/health | Existing team/independent secret/provider/health policy, not guest authority. |
| Privacy exports/deletion/holds | Principal customer authority; registered administrative roles; legal/policy safeguards. |

Audit every route, not just trip creation/page guards. Existing customer pricing projections and private errors remain.

## Errors, limits and races

Use current safe problem envelope/correlation ID. New codes: guest_session_unavailable (401), draft_revision_conflict/draft_already_submitted/idempotency_fingerprint_conflict (409), validation_error (422), booking_intent_expired (410 after proof), guest_research_limited (429 Retry-After), planning_run_access_revoked (403 service), and non-disclosing resource-not-found (404). Bound field paths/messages; no raw supplier/model/auth payloads.

Enforce two concurrent queued/running/awaiting_clarification runs and ten new requests/hour/session across principals; replay free. Terminal/interrupted runs release concurrency. Bootstrap max twenty/hour per secret-hashed network key, one-hour retention. Configurable server limits, deterministic injected clock and clear wait/retry without subscription gates.

Apply guest-session/quota guard first when relevant, then principal/draft/trip/run and existing mutation/booking locks, with authority recheck before commit/replay. Count session-wide quotas without out-of-order locks and allocate quota/run atomically. A guest request resolved before linking cannot write afterward. Event streams recheck before delivery and terminate safely on link/expiry; account can recover retained evidence.

Live review/revalidation follows successful link, never consent. Preserve original booking hashing/expiry/material-change/duplicate/partial-failure tests and dual-identity worker verification.
