# Phase 11 implementation and verification — 2026-10-16

## Implemented

T139–T143 and T154 implement the requested chat/version/booking behavior. This is not
completion of the feature's outstanding database, manual, deployment or participant gates.

- New workspace planning requests explicitly reserve an immutable `automatic` application
  policy. Existing requests default to `manual`; opening old conversations cannot accept them.
  The browser never performs automatic acceptance in a polling effect or GET handler.
- Result persistence acquires access/principal/trip/run locks in the existing order, records
  the trusted result, and composes `acceptProposal` / `apply-estimate.ts` inside that transaction.
  A savepoint converts domain conflicts into durable non-application outcomes; unexpected
  failures roll back the result, mutation, receipt and message together. Callback replay cannot
  create another version. Current grants, expiry, candidate validation, booking-write exclusion,
  inverse snapshots, authorization invalidation, audit and outbox safeguards remain.
- Actual previous/committed facts produce bounded change summaries. New public automatic
  results/events omit full proposal snapshots; durable result summaries read version records,
  not expired raw messages. Informational answers stay read-only and prompts request brevity.
  Historical accepted receipt replay reuses the stored summary rather than changing its fingerprint.
- Compact owner-scoped version checkpoints include previous/resulting version, actor, request,
  proposal/run association and current restoration eligibility. Initial/direct/restored/legacy
  records remain reachable after raw-chat expiry. Versions paginate in batches of 50, and
  unexpired redacted messages in batches of 200 using an owner-scoped precise database cursor.
- Chat renders a committed summary once, with version-specific Restore trip controls, pending
  and failure feedback, stable uncertain-request replay and polite outcome announcements.
  Refresh preserves checkpoint nodes; existing workspace logic preserves dirty editor state.
  Restoration uses the existing authoritative undo command and appends a new version. It cannot
  roll back bookings or cross non-reversible history. The unused left-pane Version history and
  Finalization review components were removed; backend immutable history remains intact.
- Book trip navigates directly to next-page review from a draft. Guest intent/link continuation
  returns to that same review without advancing the trip. Detailed itinerary preparation,
  feasibility conflicts and real acknowledgement of unverified conditions are handled there.
  Internal readiness/finalization validation remains; live revalidation and separate exact-term
  transaction authorization are unchanged. Navigation, authentication and GET never reserve/pay.
- `frontend-design` guided compact inline checkpoint footers using existing forest/sage surfaces,
  typography, wrapping and focus treatment, without adding a new visual system or dependency.

## Executed checks

The existing temporary Node 24.22.0 runtime and installed package binaries were used because
Node/pnpm were absent from PATH. No dependency install, database migration or deployment occurred.

| Check                                                                 | Actual result                                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Full web Vitest after new summaries/history/readiness tests           | 258 passed, 83 database-dependent cases skipped; 73 files                                     |
| Final focused SSR/chat/readiness regression                           | 8 passed, no skips                                                                            |
| Final automatic public-result regression                              | 2 passed; read-only projection, successful/non-applied outcomes and no full snapshot delivery |
| Web TypeScript and ESLint                                             | Passed                                                                                        |
| Optimized Next production build                                       | Passed compile, TypeScript and all 11 static pages                                            |
| Agent pytest                                                          | 88 passed                                                                                     |
| Ruff on changed agent files                                           | Passed                                                                                        |
| Pyright with explicit existing venv interpreter                       | 0 errors/warnings                                                                             |
| Source/promoted OpenAPI validation and drift                          | Passed                                                                                        |
| Rendered checkpoint layout/focus, five browser profiles × four widths | 20 passed, no skips/retries                                                                   |

The initial red chat/booking tests failed because Restore trip and draft Book trip were absent.
The summary test initially failed on the missing summary module. A subsequent failure exposed
an incorrect route-position field and optional-value serialization; both were repaired before
the passing full run. An agent assertion for superseded manual-review wording was updated while
retaining no-mutation and bounded-response assertions. Initial Pyright invocations did not resolve
the venv; the explicit interpreter invocation passed without weakening checks.

Firefox/WebKit crashed on page creation inside the sandbox (8 checks passed, 12 failed). The
approved outside-sandbox matrix passed all 20; this does not relabel the failed run as passing.
The preview configuration requires no application/database server. Chromium 320px/1440px screenshots
were inspected: checkpoint/footer/actions fit, complete focus remains visible and page overflow
is absent. Screenshot artifacts are under `web/test-results/chat-checkpoints-layout-*`.

Layout tests use actual rendered production components plus built CSS, without hydration or
provider calls. They are not live app journeys, actual browser-zoom evidence, manual screen-reader
evidence, or proof of database locking. React interaction tests separately cover exact restore
targets, uncertain retry IDs, summary deduplication, older checkpoint loading, booking navigation,
acknowledgement and blocking readiness conditions. Database tests now include automatic result
application/replay, stale-result non-application, safe chat projection and restoration; they were
skipped, not passed. Live browser narratives were updated for the new flow but could not be executed.

## Remaining gates

- T144 remains partial: focused tests and updated journeys are delivered; the full failure,
  retention/pagination, migration, callback/concurrency and real browser matrix is not proven.
- T145–T149 (and their earlier task chains) remain open for missing matrix cases and actual
  isolated PostgreSQL execution. No `TEST_DATABASE_*_URL` configuration is available. The local
  development server also reported an unavailable configured database. No tests used production data.
- T150 remains open for the full asynchronous-state/viewport/browser-zoom matrix and the separate
  previously recorded live guest WebKit refinement timeout. Static fixture passes do not resolve it.
- T151 requires actual manual keyboard/screen-reader/zoom/forced-colors journey review.
- T152 requires authorized deployed web/agent/worker compatibility and withdrawal rehearsal.
- T153 requires the amended frozen >=20-participant protocol and actual cohort evidence.

Apply reviewed migration `013_automatic_planning.sql` before the matching web deployment, then
execute isolated fresh/upgrade and live planning/linking/booking-denial regressions. The migration
adds only the immutable per-run policy and defaults existing runs to manual. Never backfill old
pending runs to automatic or delete history as a rollback. No live transactions are enabled by
this evidence. No `.specify/extensions.yml` was registered; pre/post implementation hooks are absent.
