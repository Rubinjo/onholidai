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

