# User Story 4 implementation evidence

Date: 2026-10-14. Scope: T082–T106 and the US4 remediation items T144–T153. The prerequisite checklist gate passed
(`checklists/requirements.md`: 16 checked, zero unchecked). No `.specify/extensions.yml` exists, so no hooks are registered.

## Implemented and verified behavior

- Exact-term authorization binds actor, trip version, canonical terms hash, operation, component scope and expiry.
  `assertAuthorizationTerms` rejects a scope, version, status, expiry or hash mismatch, and `hashBookingTerms` changes for
  every material fact (price, dates, travellers, inventory, supplier offer, component set, cancellation terms, origin).
- `startBooking` consumes an authorization atomically, is idempotent per authorization, and rejects an expired
  authorization before creating a transaction, a claim or an outbox event.
- The `bookTrip` Temporal workflow runs against the real worker activity set: one durable provider action per
  idempotency key, no blind retry (`maximumAttempts: 1`), a post-commit timeout recorded as `unknown` with a retained
  claim, successful confirmations kept when another component fails, and unrelated confirmations untouched.
- Replay/restart reads the durable transaction outcome instead of the local loop, so a restarted workflow repeats no
  provider write and creates no extra trip version; a settled transaction starts no further action.
- An external trip-version advance stops pending actions (`executionStatus = invalidated`) with no provider write, while a
  status/evidence-only booking version advance still permits the next component under the unchanged execution basis.
- Status-first reconciliation resolves an `unknown` outcome through provider status without repeating the write; a
  contradictory confirmation invalidates execution and preserves existing evidence. A component reschedule revalidation
  evaluates only the selected component and preserves unrelated confirmations.
- Customer-safe projections exclude supplier identity, inventory, margin and non-reversible component flags from public
  terms, the booking status payload and telemetry attributes; provider failures never echo traveller or supplier facts.
- Durable acknowledgement latency and status reads are measured (see below) rather than assumed.

## Defects found and fixed while completing US4

- JSONB array columns were written as JavaScript arrays (`booking_transactions.components`,
  `booking_authorizations.acknowledged_non_reversible_actions`, `booking_revalidations.outcomes`), which `pg` encodes as
  a PostgreSQL array literal and PostgreSQL rejects for `jsonb`. Every booking insert failed. Values are now serialized
  explicitly, matching the existing `trip_versions.change_summary` pattern.
- `bookingTransactionSchema.parse(row)` was applied to whole rows that also carry `ownerUserId`, so the strict contract
  rejected them and the activity, callback handler, status route, outcome projection and start path could never load a
  transaction. A `projectBookingTransactionRow` helper now maps stored rows to the contract.
- `commitTripMutation` only accepted the `draft`/`finalized` lifecycle states, so booking outcomes could not advance a
  trip to `partially_booked`/`booked`/`cancelled`.
- `domain/booking/authorize.ts` referenced `BookingAuthorization` without importing it; `callbacks.ts` wrote a widened
  component status into the restricted callback outcome column.
- Revalidation built booking terms from the raw snapshot departure origin, whose extra `confirmedByUser` flag is rejected
  by the strict terms contract. Full-trip and component revalidation therefore always failed; terms now carry only the
  authorized origin facts.
- `book-activities.recordBookingOutcome` re-applied an outcome after execution had already been invalidated, and the
  saga re-recorded settled components on replay; both now preserve the durable state.
- `components/booking/booking-console.tsx` called `Date.now()` during render, which the repository lint rules reject.
- The generated-artifact checks compared CRLF-checked-out files byte-for-byte, so `snapshot:contract:check` and
  `corpus:check` could never pass on a Windows checkout; comparisons now normalize line endings, and the drifted
  `snapshot-v1`/`itinerary-v1` contracts were regenerated (semantically identical to the committed schemas).

## Validation actually performed

Windows local environment with PostgreSQL 18/PostGIS from `infra/compose`, PostgreSQL credentials read from
`infra/compose/secrets`, and `TEST_DATABASE_*` pointing at role-scoped connections. Commands were run from the repository
root unless noted.

| Command | Result |
|---|---|
| `pnpm --dir web lint` | passed (0 errors, 0 warnings) |
| `pnpm --dir web typecheck` | passed |
| `pnpm --dir web snapshot:contract:check` | passed |
| `pnpm --dir web corpus:check` | passed (corpus 1.3.0, hash `sha256:797b8a4f…fb176`) |
| `pnpm --dir web test` (with `TEST_DATABASE_*`) | 40 files, 214 tests passed |
| `pnpm --dir web test` (without `TEST_DATABASE_*`) | 35 files passed, 5 database-backed files skipped |
| `pnpm test:contracts` | contract/snapshot validation passed; web contract tests 60 passed; agent contracts 31 passed |
| `agent/.venv/Scripts/python.exe -m pytest agent/tests` | 63 passed |

Targeted US4 evidence:

| Suite | Tests | Covers |
|---|---|---|
| `tests/contract/booking-api.test.ts` | 5 | canonical hash binding, expiry/scope rejection, strict request shape, customer-safe projection, documented additive routes, outcome normalization |
| `tests/contract/supply-transactions.test.ts` | — | declared capabilities, normalized provider outcomes |
| `tests/integration/booking-authorization.test.ts` | 12 | per-material-fact invalidation, non-reversible acknowledgement, expired authorization rejected before any write, idempotent start |
| `tests/integration/booking-workflows.test.ts` | 7 | one action per key, timeout-after-commit unknown, replay without repeated writes, partial failure, external advance stop, reconciliation both ways, isolated rescheduling |
| `tests/integration/booking-latency.test.ts` | 1 | durable acknowledgement ≤500 ms and first status read ≤5 s over 8 fresh requests (server-side path) |
| `tests/integration/booking-privacy.test.ts` | 5 | public terms/status/error/telemetry exclusions |
| `tests/integration/provider-callbacks.test.ts` | — | HMAC verification, unconfigured-secret rejection |
| `tests/integration/migration-compatibility.test.ts` | 21 | migrations 001–008, immutability, isolation |

Workflow tests start the real `bookTrip` Temporal workflow in an ephemeral time-skipping test server
(`@temporalio/testing`) with the production activity set wired to an isolated PostgreSQL database and deterministic
provider adapters.

Ignored because the third-party outcomes cannot be produced here: the corpus `expectedCode` for the four
`date_window_violation` cases (rejected earlier by the snapshot contract, see US3 evidence).

## Outstanding gates

- T085/T107 browser and manual journeys: `tests/e2e/booking.spec.ts` is implemented and wired into the Playwright
  projects, but it skips without `US4_BOOKING_TRIP_ID` and `US1_STORAGE_STATE`. No browser run, screen-reader pass or
  participant result is claimed, and the 2-minute asynchronous completion target remains a goal rather than a measured
  guarantee.
- T105 acknowledges the server-side durable path only; network and browser timings are not measured.
- Live provider commercial access, credentials and jurisdictional disclosures remain external dependencies.
