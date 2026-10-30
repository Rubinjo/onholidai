# Historical rollout — executed against the local stack

At the time, migrations 011 (`planning_ownership`) and 012 (`guest_drafts_and_linking`) were applied with
`pnpm --dir web db:migrate` against a database that already carried 001–010, and the fresh
and upgraded paths are both exercised by
`web/tests/integration/migration-compatibility.test.ts` (22 cases, passing). Unchanged trip,
version, run and request identifiers, snapshots, receipt fingerprints, terms hashes,
execution JSON and existing account access all survive; the new guest foreign keys and the
session/principal set-once guards behave as specified.

Current deployment uses the clean-start baseline; the previous migration history is not
upgradeable. Recreate only the `onholidai` database before deploying.

Deployment ordering:

1. Apply the baseline with the migration role before starting application services.
2. Deploy the reviewed `web` and `booking-worker` revisions together. Do not enable linked
   bookings against a worker that assumes account ids are principal ids, and do not run two
   migration runners concurrently.
3. Keep `PROVIDER_MODE=deterministic` for planning-only verification; the booking worker is
   only needed for transaction regressions.
4. Recovery is forward-only: keep `agent_runs.planning_access_revoked_at` set, keep session
   digests and link receipts, and never roll back 011/012 destructively.

To disable guest entry, withdraw public bootstrap/draft entry at the deployment edge while
preserving ownership, account booking guards, accepted history and link receipts.

## Phase 9 local worker verification — 2026-10-16

The earlier loader/startup blocker is repaired: the preload registers its Node resolve
hook (without recursive self-registration), resolves alias/directory/TypeScript imports,
and the entrypoint explicitly composes and closes its application rather than assuming
Next.js instrumentation ran. The package command includes `--conditions=react-server`
and `--experimental-transform-types` for the standalone server-only TypeScript process.

`web/tests/integration/worker-entry.test.ts` launches the actual package-command
entrypoint as a subprocess against an isolated worker-role PostGIS database and a real
Temporal test server, and observes the worker's RUNNING state. It passed. The full web
suite also passed all seven real Temporal durability scenarios and the registered
account!=principal booking regression (317 tests overall, no skips).

This verifies local startup, not deployment compatibility. The coordinated deployed
web/agent/worker rollout and deployment-edge guest-entry withdrawal rehearsal still
need an actual deployment environment. T102 remains open for those steps. Do not enable
live linked-principal bookings on the strength of this local smoke test alone; keep
accepted snapshots, link receipts, revoked grants and booking evidence on disable.
