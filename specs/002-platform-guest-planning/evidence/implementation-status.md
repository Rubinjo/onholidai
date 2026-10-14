# Implementation status: Phase 1 and foundation complete; stories open

Recorded 2026-10-14. Work-in-progress evidence, not release approval.

## What is now complete

- **Phase 1 (T001-T005)** is complete. T002's dependency prerequisite is resolved: the
  reviewed lockfile was regenerated so the `web` importer resolves the four new packages,
  and `pnpm install --frozen-lockfile` succeeds. The new UI primitives compile, lint
  cleanly and have a focus/behaviour test.
- **Phase 2 foundation (T006-T020)** is complete and verified against a local isolated
  PostgreSQL instance. Migrations 011/012 apply on fresh and upgraded databases, session
  and actor behaviour is proven, account-only booking is enforced, and safe planning
  problem codes exist. See [foundation](foundation.md) for commands, results and the
  environment issues that were worked around.

## What is still open

- User stories **US1-US5 (T021-T080)** are not implemented: no guest session/draft
  endpoints, no draft repository or hooks, no globe-first wizard, no public `/trips/new`,
  no linking/continuation, no booking dual-identity changes, no marketing homepage and no
  responsive/accessibility finish.
- Release gates **T081-T086** are open, including the participant cohort (T084) which must
  stay open until real participants are available.
- Guest endpoints remain closed; account-only booking and internal/privileged routes stay
  protected. Existing account route guards are unchanged.

## Checks and skips

- Passed: web lint, web typecheck, `pnpm test` (including 57 DB-skipped cases), isolated
  migration compatibility (22/22), legacy trip-commit (12/12 standalone), legacy
  planning/estimate, and the new session/actor/access/API/UI-primitive unit suites.
- Environment-only issues: concurrent database files exhausted local `max_connections`;
  two migration cases need a hook timeout above the 30-second default. Both were
  re-confirmed passing when run serially.
- NOT performed: participant cohort, manual assistive-technology and screenshots, browser/
  Playwright journeys, Temporal regression, production build and the full quickstart matrix.
- `.specify/extensions.yml` is absent: no extension hooks were dispatched.
