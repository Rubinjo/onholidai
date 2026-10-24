# US4 whole-trip recovery review

## Scope

This increment implements server-derived recovery lineage, a complete remaining-trip
review, fresh exact consent and a durable **review-only** child start. V2 provider
dispatch remains explicitly denied. This is not T078's executing booking/recovery
acceptance or permission to enable live writes.

No application database, live supplier, real traveller/payment identity or environment
file was used. All database checks used a disposable loopback PostGIS container and
the existing separate migration/web/worker test roles.

## Backend behavior

- Parent/root come from the server's current durable whole-trip leaf; clients cannot
  select a parent, root or subset of components.
- Active unexpired execution, outstanding claims, dispatched/unknown attempts and
  conflicting supplier evidence block a fresh review or authorization.
- Review persistence, authorization and start verify lineage under the trip lock.
  Two separate valid authorizations for the same parent yield exactly one child.
  The losing authorization cannot silently attach to a new parent.
- A further fresh review attaches to that child while retaining the original root.
  Latest-attempt restoration follows ancestry even with identical start timestamps.
- Confirmed services are read from durable confirmations, not revalidated as offers.
  Exact actual service, baggage/refund/change terms, party, dates, money, included
  taxes/fees and non-reversibility cannot be changed or omitted from recovery review.
- The synthetic four-service trip preserves its confirmed GBP100 flight and reviews
  all three remaining services for GBP300. The confirmed component never appears in
  the new write set or new payable amount.
- A definitive non-commit remains failed in durable attempt history and releases only
  its resolved guard. Its trip component becomes unbooked, allowing fresh review.
  Unknown outcomes remain unknown with their guard retained.
- An expired local stop also projects unbooked only when the locked durable records
  prove no dispatch and no saved confirmation. Its original action-required attempt
  remains visible; a claimed-but-undispatched guard can be released without pretending
  that a supplier rejected anything.
- Migration 017 makes booking outbox workflow intent unique without forbidding
  different reviews/starts at one trip version. Other trip event uniqueness remains
  unchanged. Missing/malformed workflow identities and duplicate intents are rejected.

## User interface

The existing booking console restores saved progress and confirmations, exposes one
**Review remaining whole trip** action, and shows fresh complete-trip consent beside
prior progress only for matching server-derived lineage. There is no selected-service
checkout or booking retry. Uncertainty withholds continuation/consent and preserves
status-check/support context.

The pending review control uses guarded `aria-disabled` rather than temporarily
removing itself from keyboard focus. Background restoration/polling does not focus
the new consent action. The inherited Georgia typography, neutral/green tokens and
existing controls remain unchanged; this is not a visual redesign.

## Validation

- The initial backend red run reproduced missing parent/root, active and uncertain
  predecessor bypasses, and altered saved commitment acceptance.
- Combined contract/database/Temporal/authorization/migration/privacy/review/recovery
  selection: **374 passed / 26 files / zero skips**.
- After adding the final undispatched-stop projection regression, the affected
  authorization/Temporal/callback/privacy selection passed **66 tests / 4 files /
  zero skips**. It includes definitive-failure versus uncertainty and the new local
  stop case; it does not replace the required distinct whole-trip execution matrix.
- Review/recovery UI selection after the keyboard-focus fix: **18 passed / 2 files**.
- Production Next.js 16.4.3 build, TypeScript, complete web ESLint and canonical
  agent/booking and TripSnapshot drift checks passed.

Browser journey source: `web/tests/e2e/whole-trip-recovery.spec.ts`.
Runs use the production HTTPS harness, synthetic fixture CLI, real authentication/
owner-scoped reads, and the isolated `onholidai_us3_browser` database. The CLI calls
the real review/authorization/start functions with fixture-only approved readiness.
Supplier outcomes are explicitly injected through the repository; they are not
network execution or proof of stock-worker composition.

The first five-project run passed 9/10 cases. The sole failure timed out while
starting the fixture seed process in desktop WebKit, before the journey began.
An unchanged-limit focused rerun of that exact case passed (1/1, 1.2 minutes).
Thus both recovery-review cases have passing evidence in Chromium, Firefox, WebKit,
mobile Chromium and mobile WebKit. The original failure is retained here; no timeout
or acceptance threshold was increased.

The successful cases exercise confirmed/failed/unknown/not-attempted labels, 320px
layout without horizontal overflow, keyboard review/consent, focus retention,
GBP300 remainder, exact parent/root, one child and restored confirmations on reload.
The uncertain case creates no continuation or additional attempts.

## Remaining release gates

T061/T077's >=100 distinct executing duplicate/concurrency/restart/timeout/
continuation cases, restricted supplier HTTP clients, trusted dispatch prerequisites,
stock-worker composition/transition, executing whole-trip success/status recovery and
T078 certification remain open. No live entitlement, Nuitee safe final-terms/payment
approval, operational support channel, screen-reader certification or participant
evaluation is inferred from these tests.
