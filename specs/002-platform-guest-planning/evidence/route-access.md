# Route access inventory

Baseline inspection: 2026-10-14. This is a route inventory, not evidence of implemented guest access.

## Intended boundaries

- Public pages: `/`, `/trips/new`, `/sign-in`, `/sign-up`. Only the first and sign-in are public at baseline; setup is still account-gated and sign-up is absent.
- Planning: draft/session endpoints, places, trip read/history/events, conversation, agent runs/clarifications, proposal review, edit/undo/finalize require the resource's current PlanningActor. Places becomes public bounded lookup. Direct trip POST remains registered account creation; guest creation goes through a persisted draft.
- Booking: booking page, revalidation/authorization/start, status and every component recovery/cancel/reschedule operation require registered BookingActor plus current account/principal relation and existing lifecycle/capability/consent checks.
- Internal planning: signed scoped context plus an unrevoked run grant and live principal authority, including reads and replays. Internal pricing retains its independent diagnostic secret/team boundary.
- Provider callbacks retain independent provider credentials. Health is a non-private readiness boundary. Auth uses the existing Better Auth handler.
- Privacy export/deletion/holds require current customer principal authority or existing registered administrative roles; expiry is never evidence-deletion authority.

## Existing API files

The guard column is a source search aid, not a proof that every branch enforces access. Each planning entry needs a live principal check; all booking entries keep registered account authentication.

| Route source | Baseline guard references |
| --- | --- |
| `web/app/api/auth/[...all]/route.ts` |  |
| `web/app/api/health/route.ts` |  |
| `web/app/api/v1/agent-runs/[runId]/clarifications/route.ts` | browserUser |
| `web/app/api/v1/agent-runs/[runId]/events/route.ts` | browserUser |
| `web/app/api/v1/agent-runs/[runId]/route.ts` | browserUser |
| `web/app/api/v1/booking/revalidations/[workflowId]/route.ts` | browserUser |
| `web/app/api/v1/bookings/[bookingId]/components/[componentId]/cancellations/route.ts` | browserUser |
| `web/app/api/v1/bookings/[bookingId]/components/[componentId]/recovery/route.ts` | browserUser |
| `web/app/api/v1/bookings/[bookingId]/components/[componentId]/reschedule-authorizations/route.ts` | browserUser |
| `web/app/api/v1/bookings/[bookingId]/components/[componentId]/reschedule-revalidations/route.ts` | browserUser |
| `web/app/api/v1/bookings/[bookingId]/components/[componentId]/reschedules/route.ts` | browserUser |
| `web/app/api/v1/bookings/[bookingId]/route.ts` | browserUser |
| `web/app/api/v1/internal/agent-runs/[runId]/dispatch/route.ts` | internalActor |
| `web/app/api/v1/internal/agent-runs/[runId]/events/[cursor]/route.ts` | internalActor, provider |
| `web/app/api/v1/internal/agent-runs/[runId]/events/route.ts` | internalActor |
| `web/app/api/v1/internal/agent-runs/[runId]/result/route.ts` | internalActor |
| `web/app/api/v1/internal/agent-runs/[runId]/resumes/[questionId]/route.ts` | internalActor |
| `web/app/api/v1/internal/agent-runs/[runId]/route.ts` | internalActor |
| `web/app/api/v1/internal/agent-runs/[runId]/validate/route.ts` | internalActor |
| `web/app/api/v1/internal/booking/provider-callbacks/[provider]/route.ts` | provider |
| `web/app/api/v1/internal/context/search/route.ts` | internalActor |
| `web/app/api/v1/internal/pricing/[tripId]/route.ts` | internalActor |
| `web/app/api/v1/internal/trips/[tripId]/agent-view/route.ts` | internalActor |
| `web/app/api/v1/internal/trips/[tripId]/planning-search/route.ts` | internalActor, provider |
| `web/app/api/v1/internal/trips/[tripId]/proposals/route.ts` | internalActor, provider |
| `web/app/api/v1/places/route.ts` | browserUser, provider |
| `web/app/api/v1/trips/[tripId]/agent-runs/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/booking/authorizations/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/booking/revalidations/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/bookings/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/commands/edit/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/commands/edit-preview/route.ts` | browserUser, provider |
| `web/app/api/v1/trips/[tripId]/commands/finalize/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/commands/undo/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/conversations/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/events/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/proposals/[proposalId]/accept/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/proposals/[proposalId]/reject/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/route.ts` | browserUser |
| `web/app/api/v1/trips/[tripId]/versions/route.ts` | browserUser |
| `web/app/api/v1/trips/route.ts` | browserUser |

## Required principal/account joins

`web/domain/booking/{revalidate,authorize,start,reschedule,apply-outcomes}.ts`,
`web/server/booking/routes.ts`, `web/server/workflows/{book-activities,revalidate-activities}.ts`
currently equate registered account identity with trip owner. Change trip locks/reads/commits to the
planning principal, retain the real account in booking records/fingerprints/immutable execution
bases, and recheck the relation under locks. Status/revalidation/component routes need the same
relation. Do not expose booking for linked principals until all domain/worker paths are compatible.

`web/server/privacy/{export-delete,retention}.ts` compares owner keys with accounts today.
Resolve customer authority through principals while retaining account-only administrative roles,
legal holds, 90-day raw-message expiry and 24-month review.

`web/domain/trip/{read,commit,create,edit,accept-proposal,finalize}.ts` and trip/proposal/conversation/
run/history/idempotency repositories need current principal checks before private replay/commit.
Streams must recheck before delivery; linking must revoke service grants, not rewrite owner keys.

## Baseline validation

Prerequisite script selected the requested feature. Requirements checklist: 16/16 checked.
Git whitespace check passed for tracked edits at inspection. Node.js/pnpm/Docker test runs are
skipped by user direction. No fresh/upgrade database or behavioral contract result is available;
no migration or guest access gate is recorded as passed. Historical migrations 001–010 are intact.

# Implementation route audit — 2026-10-15

Planning trip read/history/events/conversations/edit-preview/edit/undo/finalize/proposal accept/reject/run reserve and run read/events/clarification use current PlanningActor guards. Resource owners are derived server-side; successful private actions hold principal/session/trip locks through reads or mutations. Event responses are finite and reconnects recheck authority.

Internal context/trip/run routes use signed service tokens plus live principal/run grants; original audience/scope/header/body checks remain in handlers. Pricing diagnostics and provider callbacks retain their independent registered-team/service-secret guards.

All trip booking revalidate/authorize/start and booking status/revalidation/component recover/cancel/reschedule route families use registered browserUser plus BookingActor/account-principal relation. Domain and worker checks retain actual account execution identity and stable trip principal. Guests remain denied direct booking API calls.

New bootstrap/draft endpoints require same-origin mutation and server-derived authority. Intent creation requires selected guest-trip proof; explicit POST linking requires account plus original guest proof or same-account consumed receipt. Auth continuation GET is read-only. Free registration collects identity, not financial consent.

Privacy helpers accept proven PlanningActor or registered owner/team roles. Static route audit is not runtime access-matrix evidence; deployment and exhaustive tests remain open.

## Runtime access verification — 2026-10-15

The static audit above is now backed by executed checks on a migrated local stack:

- `web/tests/contract/guest-planning-api.test.ts` proves that possessing a trip, version or run identifier is not authority and that unrelated proof is rejected before payload validation on every private route family.
- `web/tests/contract/guest-setup-api.test.ts` proves the bootstrap/draft endpoints require same-origin mutation, deliver an HttpOnly private cookie, replay a duplicate allocation to the same draft and deny an unrelated guest.
- `web/tests/integration/guest-planning.test.ts` proves acknowledgment data survives authority revocation, that session-wide concurrency releases terminal work, and that replay is free.
- `web/tests/integration/account-linking.test.ts` and `booking-planning-identity.test.ts` prove one selected owner after a link race, retained version/history, revoked former guest authority and zero booking records or provider writes.
- `web/tests/integration/migration-compatibility.test.ts` (22 cases) proves fresh and 001–010 upgrade paths keep legacy identities and add the new guest foreign keys.

Remaining gate: coordinated web/worker deployment is still unconfirmed because the compose
`booking-worker` cannot start (pre-existing `alias-loader.mjs` hook registration), so booking
for linked principals is not enabled and T068 stays open.

## Phase 9 update — 2026-10-16

The local standalone worker blocker above is now repaired and its actual entrypoint
smoke test passes; deployed rollout remains unverified (see `rollout.md`).

The real HTTP denial matrix now separately exercises unrelated guests, unrelated signed-in
accounts, expired owner cookies, old guest proof after linking, and identifiers without
proof. It covers private trip/history/events/conversation/edit/undo/finalize/proposal/
run/clarification handlers, private cache headers and lack of booking side effects.
Owner reads and fresh guest browser mutations also execute. The booking intent/link
contracts exercise same-origin guards, private response headers, real account cookies,
30-minute unused-intent expiry, consumption/replay and old-guest denial. Browser sign-up,
explicit same-trip link, sign-out denial and sign-in recovery preserve the snapshot and
version. These additions are included in the 317-test green web suite and focused
22-journey Chromium run.

The exhaustive valid-operation/internal-service/stream matrix and every dual-identity
transaction recovery branch are still unfinished T098/T101, not inferred from predicate
tests or startup success. The requested guest notice uses current authenticated session
status and does not relax any booking authorization requirement.

