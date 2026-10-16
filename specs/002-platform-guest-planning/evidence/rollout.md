# Rollout — executed against the local stack

Migrations 011 (`planning_ownership`) and 012 (`guest_drafts_and_linking`) were applied with
`pnpm --dir web db:migrate` against a database that already carried 001–010, and the fresh
and upgraded paths are both exercised by
`web/tests/integration/migration-compatibility.test.ts` (22 cases, passing). Unchanged trip,
version, run and request identifiers, snapshots, receipt fingerprints, terms hashes,
execution JSON and existing account access all survive; the new guest foreign keys and the
session/principal set-once guards behave as specified.

Deployment ordering, still requiring a coordinated release:

1. Apply migrations 011 and 012 with the migration role before starting either revision.
2. Deploy the reviewed `web` and `booking-worker` revisions together. Do not enable linked
   bookings against a worker that assumes account ids are principal ids, and do not run two
   migration runners concurrently.
3. Keep `PROVIDER_MODE=deterministic` for planning-only verification; the booking worker is
   only needed for transaction regressions.
4. Recovery is forward-only: keep `agent_runs.planning_access_revoked_at` set, keep session
   digests and link receipts, and never roll back 011/012 destructively.

To disable guest entry, withdraw public bootstrap/draft entry at the deployment edge while
preserving ownership, account booking guards, accepted history and link receipts.

**Blocked:** the compose `booking-worker` crash-loops because
`web/server/workflows/alias-loader.mjs` exports a `resolve` hook but never calls
`module.register`, so `@/*` specifiers reach Node as bare package names
(`Cannot find package '@/server'`). This predates this feature (introduced with the booking
worker) and is reported rather than changed here.
