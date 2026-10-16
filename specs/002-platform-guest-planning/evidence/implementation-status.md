# Implementation status: stories delivered and verified against Node.js, pnpm and Docker

## Current handoff — 2026-10-15 (supersedes the earlier handoffs below)

US1–US5 source is delivered **and now runs**. The earlier handoffs recorded that Node.js,
pnpm and Docker checks were skipped; this pass executed them on a full local stack
(Node 24.21.0, pnpm 12.11.2, Docker Desktop 29.6.1, PostGIS 18-3.6, Temporal 1.27.2) with
the reviewed lockfile, an isolated test database and the real deterministic agent.

Verification is green:

| Check | Command | Result |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | passed |
| Web lint | `pnpm --dir web lint` | 0 problems |
| Web typecheck | `pnpm --dir web typecheck` | passed |
| Repo lint (web + agent ruff) | `pnpm lint` | passed |
| Repo typecheck (tsc + pyright) | `pnpm typecheck` | 0 errors, 0 warnings |
| Web unit/contract/integration | `pnpm --dir web test` with `TEST_DATABASE_*` | 55 files, 283 tests, 0 failed, 0 skipped |
| Browser journeys | `pnpm --dir web test:e2e` (5 projects) | 82 passed, 0 failed, 20 fixture-gated skips |
| Production build | `pnpm --dir web build` | passed |
| Agent tests | `uv run --project agent pytest agent/tests` | 75 passed |
| Contract checks | `pnpm test:contracts` | web 75 passed/3 skipped, agent exports verified |

## Defects found by running the stack, and fixed

Every item below reproduced, was fixed, and is covered by the suite recorded above.

1. `internalPlanningApiResponse` lost its `options` parameter while the internal proposals
   route still passed `{ status: 201 }`; `pnpm --dir web typecheck` failed. Options are
   forwarded again.
2. `reserveBootstrap` incremented an unqualified `session_count` inside `ON CONFLICT DO
   UPDATE`, which Postgres rejects as ambiguous. Every guest bootstrap returned 500, so no
   guest could plan at all. The column is now qualified.
3. `use-setup-draft` compared saved and local payloads with `JSON.stringify`. Postgres jsonb
   does not preserve key order, so the comparison never matched: autosave looped and a
   reload lost the draft. Comparison now uses the shared canonical serializer.
4. The setup wizard focused its step heading on first render, which overrode the document
   start and skipped the skip link. Heading focus now happens only on a real step change.
5. `verifyServiceToken` rejected an empty `requiredScopes` list. The new internal wrapper
   verifies without requiring a scope, so every agent→web callback returned 401 and research
   runs expired without progress. An empty requirement is now meaningful.
6. `expireRawConversationMessages` opened its own transaction while the request already ran
   inside one, so `GET /api/v1/trips/{id}/conversations` returned 500. It composes through
   `inTransaction` now.
7. The trip editor's `fieldset` kept the user-agent min-content floor and overflowed the
   narrowest pane. `min-width: 0` restores the documented no-overflow rule.
8. The price bar lost its `contentinfo` landmark once the grid placed it inside `<main>`;
   the role is set explicitly.

Two pre-existing 001 behaviours were also observed in Docker and are **not** fixed here:
the compose `booking-worker` cannot start because `server/workflows/alias-loader.mjs` never
registers its resolution hooks, and `next build` must run with `NODE_ENV=production`
(a `development` override produces a spurious prerender failure).

## Accuracy notes

- Guest browser journeys share one per-network bootstrap allowance (200/hour is the schema
  maximum). Repeated runs inside the hour exhaust it; clear the ephemeral
  `app.guest_bootstrap_buckets` rows before re-running. See the quickstart.
- The two refinement journeys commit and undo work on a seeded trip, so each needs its own
  freshly seeded trip id (`US2_TRIP_ID`, `US2_REFINEMENT_TRIP_ID`); they run on one project
  because they mutate that shared fixture.
- A production build served over plain HTTP cannot hold its `Secure` guest cookie in
  Safari/WebKit, so the cross-browser matrix runs against the configured dev server; the
  production build is verified separately.

## Still open

- **T079** manual assistive-technology, forced-colour and 200% zoom checks with screenshots.
  Automated responsive/state/focus checks pass, but they do not replace manual review.
- **T084** participant cohort (>=20 people). No timings, denominators or ratings were
  measured and none are fabricated.
- **T068** coordinated web/worker deployment confirmation: blocked by the pre-existing
  booking-worker entrypoint defect above, so linked-principal booking is not enabled.
- Remaining exhaustive-scenario gaps are listed in [coverage.md](coverage.md).
