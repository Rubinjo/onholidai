# Data Model: Platform UX, Guest Planning & Account Creation

Add migrations after 010 in existing app schema; snake_case SQL/camelCase Kysely mappings. Preserve historical snapshots, owner keys, fingerprints, audit/booking evidence and domain validation.

## Relationships

```text
account --1:N--> planning principal --1:N--> trips --> immutable versions
guest session --1:N--> unlinked guest principals
guest principal --1:1--> setup draft --0:1--> submitted trip
selected guest principal --link once--> account
booking records --> account + trip (existing account FKs)
```

Default account principal may own many legacy/direct-created trips. Every wizard draft allocates its own non-default principal: guest-origin with session authority, or account-origin already linked to the current account. Each draft principal owns that one draft/resulting trip, enabling a unique draft-owner constraint and selected-trip-only linking without limiting an account to one wizard trip.

## PlanningPrincipal: planning_principals

| Field | Constraint |
| --- | --- |
| id | text primary key; backfill account IDs verbatim; new guest ID is UUID compatible with service tokens. |
| account_user_id | Nullable account FK, ON DELETE RESTRICT. |
| guest_session_id | Nullable guest-session UUID FK, ON DELETE RESTRICT. |
| origin_kind | Immutable required enum account or guest. |
| is_default | Required boolean, true only for account primary; partial unique account-default index. |
| created_at / linked_at | Required creation timestamp; nullable timestamp set once on guest linking. |

Exactly one authority field is non-null. Account default has id=account_user_id, origin_kind=account, is_default=true. Guest-origin has is_default=false, keeps guest provenance after linking, and cannot transfer to another account or revert to guest. Link receipt retains original session.

Backfill every account default and lazy-create new defaults transactionally. Repoint trips.owner_user_id, conversations.owner_user_id and privacy_legal_holds.owner_user_id to principals, preserving values. Composite run/conversation keys, draft-edit owners, immutable versions stay unchanged. Auth and booking owners still reference accounts; hold administrative actors remain registered authorized team members.

## GuestPlanningSession: guest_planning_sessions

| Field | Constraint |
| --- | --- |
| id | UUID primary key; reference alone is not authority. |
| credential_digest | Required unique lowercase SHA-256 hex, exactly 64 characters; never plaintext credential. |
| created_at / last_activity_at / expires_at | Required timezone-qualified timestamps; activity at/after creation, expiry after activity. |
| revoked_at | Nullable timestamp; revocation prevents renewal/access. |

32 random bytes form a base64url cookie, HttpOnly, host-only, Path=/, SameSite=Lax and Secure in production. Name: __Host-onholidai-planning for production, onholidai-planning-dev for local HTTP. Valid requests renew idle expiry to now+30 days; expired/revoked cookies cannot revive old access. No identity/payment fields. Preserve cookie through authentication to prove explicit linking.

## SetupDraft: setup_drafts

| Field | Constraint |
| --- | --- |
| id / planning_owner_id | UUID primary key / required unique principal FK; one draft per dedicated wizard principal. |
| revision | Positive integer starting at 1; expected-revision comparison and one increment per committed save. |
| current_step | destinations, origin, dates, travellers, preferences, review. |
| payload / schema_version | Strict bounded JSON input object, maximum 262144 serialized bytes; positive schema version, initially 1. |
| creation_request_id / research_request_id | Required distinct immutable server UUIDs per draft. |
| submitted_trip_id | Nullable unique trip FK; once attached cannot change to another trip. |
| created_at / updated_at | Required timestamps, update at/after creation. |

Partial payload allows incomplete fields: title up to 120 characters, empty until review; supported ISO currency; optional/unconfirmed origin; zero-to-eight canonical destinations; up to 32 availability windows with empty dates; nullable numeric duration inputs; existing ten-traveller limit with missing child ages; five integer 0–100 preferences; up to 64 requirements, wording up to 1000 characters, empty until submit. Missing numeric value is null, not age zero. Bounded draft input state is distinct from valid trip facts; complete selected destinations retain existing identity/timezone/location schema. Full existing domain schema and confirmed origin are required at submission.

A save checks current authority and revision under lock. Conflict commits nothing and preserves local edits for reload/compare. Submission validates, creates initial trip through existing commit and attaches ID atomically; repeat resolves same trip/research request. Submitted drafts reject later setup saves; changes go through existing trip edits/proposals. Initial research reserves afterward with persistent request ID; interrupted research cannot cause another trip. Linking advances draft revision without changing payload/step.

## BookingIntent: booking_intents

| Field | Constraint |
| --- | --- |
| id | UUID primary key; opaque reference is insufficient authority. |
| trip_id / planning_owner_id / guest_session_id | Required selected-trip/principal/original-session FKs. |
| request_id / fingerprint | UUID unique per guest session / canonical SHA-256 fingerprint. |
| action | Sole value review_booking, never execution/payment. |
| state | pending, consumed, expired. |
| created_at / expires_at | Required timestamps; pending lifetime 30 minutes. |
| consumed_by_user_id / consumed_at | Account FK/time, both present exactly when consumed. |

Create after guest ownership and eligible capability check. New link requires valid original guest session and registered account. Expired unused intent can be replaced through guest booking entry. Consumed link receipt replays to its same proven account after guest-cookie or intent expiry; other accounts cannot inspect outcome. Derive next route from authorized trip; store no arbitrary return URL.

## AccountLinkReceipt: planning_account_links

| Field | Constraint |
| --- | --- |
| planning_owner_id | Unique/primary principal FK; one successful guest binding. |
| trip_id / guest_session_id / account_user_id / intent_id | Required immutable outcome/provenance FKs. |
| request_id / fingerprint | Required UUID / SHA-256; conflicting reuse rejected. |
| linked_at / trip_version_at_link | Required timestamp / positive audit version; no version advance. |

Append-only. Transaction sets account binding/clears guest, increments draft revision, revokes old run grants/interrupts active research, consumes intent and appends link/audit evidence. Same-account retry via another valid pending intent resolves original receipt; different account denied. No historical version/run identity/dispatch/fingerprint/audit rewrite, proposal acceptance or booking action.

## Run access and research limits

Add nullable agent_runs.planning_access_revoked_at; set once on every pre-link run for selected principal. Active queued/running/awaiting_clarification runs become failed/interrupted, lease closed, safe evidence durable. Completed/proposed results and pending proposal expiry/status remain; browser account may read them while old service grants fail. Retries create fresh request/run; do not clear revocation. Legacy account-run grants remain null and compatible.

All internal planning endpoints resolve signed principal/trip/request/version to an unrevoked run grant, including agent-view/context/search and proposal/event/result/resume writes. Expired guest authority rejects service access independently of signed TTL.

A bounded guest_research_requests ledger stores guest session/request/run IDs and accepted_at, unique request/session, one-hour quota retention. Under transactional session guard count active runs across session principals (maximum two) and ten distinct new runs/hour. Replay lookup precedes quota allocation. Short-lived secret-hashed network buckets limit new sessions to twenty/hour, retained one hour with no raw IP logging. Server-configurable defaults use deterministic clock tests.

## Booking identity and concurrency

Existing booking table owners, BookingAuthorization.userId and executionBasis.ownerUserId remain registered account IDs. BookingActor carries proven accountUserId and planningOwnerId. Use principal for trip state/commits and account for booking records/fingerprints/authorization. Workers prove immutable execution account still matches principal relation. No booking JSON/hash rewrite.

Lock order: guest-session/quota guard when applicable, principal, draft if present, trip, run, then existing mutation/idempotency/booking rows. Renewal, quota allocation, linking and guest mutations follow the same order. Session-wide counts do not lock scanned principal/run rows out of order; new run reservation and quota acceptance commit atomically. Resolve references without disclosure and recheck authority under lock before private replay or commit. Apply to overlapping linking/submission/edit/accept/callback paths and terminate old guest streams before further private delivery.

The immutable draft research_request_id identifies the first reservation, not every future research attempt. Lost reservation responses replay that same ID. A terminal failed or revoked run requires a fresh request/run UUID (persisted before dispatch in the existing run reservation receipt); retain the original draft ID, original receipt and submitted trip. Retry UI must never redispatch a revoked grant or clone the trip.

## Retention and migration

30-day guest access expiry is distinct from record deletion; 90-day raw messages and 24-month trip/partial-draft review follow existing policy/holds. Session/intent/ledger housekeeping cannot cascade-delete principals/evidence. Privacy export/delete resolves principal authority; team roles stay account-bound. New audit facts distinguish guest/account without secrets; old entries remain unchanged.

011 creates sessions/principals, backfills accounts and repoints planning/legal-hold FKs; create session table before principal session FK. 012 adds drafts/intents/link receipts, run revocation and limits. Preserve migrations 001–010, existing least-privilege grants and immutable guards. Upgrade/fresh tests compare IDs, snapshots, receipts, terms hashes/execution JSON, old account access and new guest ownership. Feature-disable rollback preserves accepted guest records.
