# Foundation evidence: Phase 2 (T006–T020)

Recorded 2026-10-14. Work-in-progress evidence for the blocking foundation, not release approval.

## Environment and prerequisites

- Node 24.21.0 and pnpm 12.11.2 (matches `packageManager`).
- `pnpm install --frozen-lockfile` now succeeds: the reviewed lockfile was regenerated
  so the `web` importer resolves `@tailwindcss/postcss`, `class-variance-authority`,
  `clsx` and `tailwind-merge`. This cleared the T002 prerequisite that stopped the
  previous revision.
- A local PostgreSQL 18.6/PostGIS instance is reachable. Isolated test databases were
  provisioned through the existing helper using the compose secrets, so database-backed
  checks executed instead of skipping. No secret value was printed.
- `.specify/extensions.yml` is absent: no pre/post hooks were dispatched.

## Checks actually run

| Check                                 | Command                                                                                    | Result                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------- |
| Web lint                              | `pnpm --dir web lint`                                                                      | PASS, 0 errors/warnings |
| Web typecheck                         | `pnpm --dir web typecheck`                                                                 | PASS                    |
| Web unit/integration (no DB env)      | `pnpm --dir web test`                                                                      | 184 passed, 57 skipped  |
| Migration compatibility (isolated DB) | `vitest run tests/integration/migration-compatibility.test.ts` with `--hookTimeout=120000` | PASS 22/22              |
| Legacy trip commits                   | `vitest run tests/integration/trip-commit.test.ts`                                         | PASS 12/12              |
| Legacy planning + estimate            | `vitest run tests/integration/trip-planning.test.ts tests/integration/estimate.test.ts`    | PASS                    |
| Planning session unit                 | `tests/unit/planning-session.test.ts`                                                      | PASS 4/4                |
| Planning actor unit                   | `tests/unit/planning-actor.test.ts`                                                        | PASS 8/8                |
| Planning access unit                  | `tests/unit/planning-access.test.ts`                                                       | PASS 3/3                |
| API boundary unit                     | `tests/unit/api.test.ts`                                                                   | PASS 6/6                |
| UI primitives                         | `tests/unit/ui-primitives.test.tsx`                                                        | PASS 4/4                |

## Migrations verified (T008–T013)

`011_planning_ownership.sql` and `012_guest_drafts_and_linking.sql` apply cleanly to a
fresh database and to a 001–010 upgrade. The migration suite proves: legacy account
owner IDs are backfilled to default principals verbatim, historical snapshots/versions
are not rewritten, plaintext session credentials are rejected while 64-character SHA-256
digests are accepted, guest principals cannot hold both or neither authority, and
run/revocation/append-only guards are present. Booking/deletion/link receipts stay
append-only and no migration cascades into durable history.

## Behaviours proven by new tests (T006, T007, T017, T018)

- Opaque planning sessions: SHA-256 digest storage distinct from the credential, the fixed
  30-day idle window, and `__Host-`/dev cookie flags with no authority in URLs.
- Actor resolution: account and guest authorities are isolated; revoked or expired guest
  sessions are denied; unknown or mismatched authorities fail with a non-disclosing 404.
- Account-only booking: `resolveBookingActor` resolves only through the account-linked
  principal and denies guests and unlinked accounts.
- Safe problem codes with the specified statuses and `Retry-After` for `guest_research_limited`.
- Lock helpers compose the documented order (`session`/quota guard when applicable →
  `principal` → `draft` → `trip` → `run`).

## Known environment issues (not code failures)

- Running several database files concurrently exhausted the local `max_connections`
  (100) and produced four intermittent `trip-commit` failures plus one PostgreSQL
  `administrator command` unhandled error. Re-running serially or standalone passes.
  Thirty-one leftover `onholidai_test_*` databases from the interrupted run were dropped.
- At the default 30-second hook timeout, two migration cases time out while provisioning
  an isolated database; a 120-second hook timeout passes them without code changes.

## Outstanding

- T018's quota-guard step is composed together with the guest research limits introduced
  in T037 (US1); the lock helpers themselves are delivered here.
- T019 required no behavioural edit: `trips.owner_user_id` now references
  `app.planning_principals`, account default principals reuse the account id, and the
  existing ownership checks already require the current principal before replay. The
  owner field name is kept because it is part of persisted receipt fingerprints, so
  renaming it would break existing receipts.
- Manual assistive-technology checks, screenshots, participant tasks, the browser/
  Playwright journeys, Temporal regression, build and the full quickstart matrix were
  NOT performed. Story phases (US1–US5) and the release gates remain open.
