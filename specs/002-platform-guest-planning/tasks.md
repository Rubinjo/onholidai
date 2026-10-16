---
description: "Dependency-ordered implementation tasks for Platform UX, Guest Planning & Account Creation"
---

# Tasks: Platform UX, Guest Planning & Account Creation

**Input**: Design artifacts in `specs/002-platform-guest-planning/`: [plan](plan.md), [spec](spec.md), [research](research.md), [data model](data-model.md), [contracts](contracts/README.md), [quickstart](quickstart.md).

**Prerequisites**: Existing `web/`, `agent/`, database/contract/test infrastructure and the resolved design above. This document authorizes no implementation by itself; all tasks are initially unchecked.

**Tests**: Required by the specification's regression, accessibility and outcome gates and the constitution. Write new behavioral tests before implementing their behaviors, prove failure for the intended missing capability rather than missing infrastructure, and run relevant existing regressions. Database/browser skips are not passing evidence. Tests do not substitute for participant outcomes.

**Organization**: Setup → shared foundation → five prioritized stories → cross-cutting release gates. Each story states a seeded independent test. Core accessibility and booking protection apply in every increment; US5 finishes polish rather than postponing correctness.

## Format: `[ID] [P?] [Story] Description`

All task lines use `- [ ] Tnnn [P?] [USn?] Description with exact file paths`. [P] means independent file work within a ready test-authoring batch; it does not waive prerequisites. Story tags appear only within story phases. Unmarked tasks execute in listed order. Paths are repository-relative; new paths are proposed additions. Append migrations, never modify applied 001–010 or immutable historical evidence.

## Path Conventions

Use existing `web/app`, `web/components`, `web/domain`, `web/server` and `web/tests` conventions. Named route inventories clarify exhaustive families where routes span many files. Read contracts/data-model when implementing; constraints quoted in schema tasks are binding, not discretionary defaults. Preserve agent wire planning userId and booking registered-account userId distinctions.

## Phase 1: Setup (Shared Infrastructure)

**Goal**: Prepare the existing web workspace and freeze acceptance evidence without replacing the stack.

**Independent Test / Checkpoint**: Locked toolchain builds a minimal themed shadcn control and the acceptance/route inventories identify every safety boundary.

- [X] T001 Freeze SC-001–SC-010 task briefs, scenario denominators, synthetic fixtures and the >=20-person cohort protocol (>=5 keyboard/screen-reader, >=5 family, >=5 multi-destination planners) in `specs/002-platform-guest-planning/evidence/protocol.md`; identify required future participant evidence without fabricating results.
- [X] T002 Configure only source-required shadcn class helpers and matching Tailwind v4 PostCSS dependency in `web/package.json`, `web/postcss.config.mjs`, `web/components.json`, `web/lib/utils.ts` and `pnpm-lock.yaml`; select Radix/current @/* aliases, RSC/TSX, app/globals.css and empty Tailwind config; retain existing calendar/map/auth stack and defer Motion.
- [X] T003 Map semantic shadcn/Tailwind tokens to existing canvas/surface/text/accent/danger/border/focus variables in `web/app/globals.css`; preserve legacy --accent meaning, typography, focus/forced colors, and scope legacy planning-page rules so they do not override new components.
- [X] T004 Copy only required Radix shadcn Button/Input/Textarea/Label/Card/Badge/Progress/Skeleton/Alert/Dialog/Sheet source into `web/components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `label.tsx`, `card.tsx`, `badge.tsx`, `progress.tsx`, `skeleton.tsx`, `alert.tsx`, `dialog.tsx` and `sheet.tsx`; reuse `accessible-field.tsx`/`status-announcer.tsx`, remove unused registry imports and prove visible focus.
- [X] T005 Inventory every existing browser/internal/booking/privacy route and its intended actor/capability guard in `specs/002-platform-guest-planning/evidence/route-access.md`, using `contracts/planning-api.md`; record baseline migration/contract checks and files needing principal/account joins.

**Checkpoint**: Complete the stated gate before advancing; do not mark unfinished implementation or missing external evidence complete.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Establish compatible storage and distinct guest planning/registered booking authority before any story is exposed.

**Independent Test / Checkpoint**: Fresh and upgraded databases retain legacy evidence; typed actor resolution proves current access; guest authority never satisfies account-only booking or privileged routes.

**Blocking gate**: Finish this foundation before story implementation. Guest planning endpoints remain closed until their complete story checkpoint; account-only booking remains protected.

### Foundation regression tests

- [X] T006 [P] Write pre-implementation fresh/001–010-upgrade migration cases in `web/tests/integration/migration-compatibility.test.ts` for unchanged trip/version/run/request IDs, snapshots, receipt fingerprints, terms hashes, execution JSON, existing account access and new guest FKs; assert these new behaviors fail before the migrations.
- [X] T007 [P] Write credential/current-principal tests in `web/tests/unit/planning-session.test.ts` and `web/tests/unit/planning-actor.test.ts` for expiry/renewal, account/guest isolation, rejected client owner IDs, safe errors and account-only booking/diagnostic denial; use deterministic clock/randomness.
### Implementation

- [X] T008 Add `web/server/db/migrations/011_planning_ownership.sql` with session storage first: id "UUID primary key; reference alone is not authority", credential_digest "Required unique lowercase SHA-256 hex, exactly 64 characters; never plaintext credential", timestamps "Required timezone-qualified timestamps; activity at/after creation, expiry after activity", revoked_at "Nullable timestamp; revocation prevents renewal/access"; preserve installed migrations/grants.
- [X] T009 Extend `web/server/db/migrations/011_planning_ownership.sql` with principals: id "text primary key; backfill account IDs verbatim; new guest ID is UUID compatible with service tokens", account_user_id "Nullable account FK, ON DELETE RESTRICT", guest_session_id "Nullable guest-session UUID FK, ON DELETE RESTRICT", origin_kind "Immutable required enum account or guest", is_default "Required boolean, true only for account primary; partial unique account-default index", timestamps "Required creation timestamp; nullable timestamp set once on guest linking"; enforce "Exactly one authority field is non-null", backfill account defaults unchanged and repoint only trip/conversation/legal-hold owner FKs.
- [X] T010 Create `web/server/db/migrations/012_guest_drafts_and_linking.sql` draft schema: id/owner "UUID primary key / required unique principal FK; one draft per dedicated wizard principal", revision "Positive integer starting at 1; expected-revision comparison and one increment per committed save", step "destinations, origin, dates, travellers, preferences, review", payload/version "Strict bounded JSON input object, maximum 262144 serialized bytes; positive schema version, initially 1", creation/research IDs "Required distinct immutable server UUIDs per draft", submitted_trip_id "Nullable unique trip FK; once attached cannot change to another trip", timestamps "Required timestamps, update at/after creation".
- [X] T011 Extend `web/server/db/migrations/012_guest_drafts_and_linking.sql` with intents: id "UUID primary key; opaque reference is insufficient authority", trip/principal/session "Required selected-trip/principal/original-session FKs", request/fingerprint "UUID unique per guest session / canonical SHA-256 fingerprint", action "Sole value review_booking, never execution/payment", state "pending, consumed, expired", timestamps "Required timestamps; pending lifetime 30 minutes", consumption "Account FK/time, both present exactly when consumed"; links: owner "Unique/primary principal FK; one successful guest binding", related IDs "Required immutable outcome/provenance FKs", request/fingerprint "Required UUID / SHA-256; conflicting reuse rejected", link/version "Required timestamp / positive audit version; no version advance"; install append-only receipt guards.
- [X] T012 Complete `web/server/db/migrations/012_guest_drafts_and_linking.sql` with nullable `agent_runs.planning_access_revoked_at` set-once enforcement, guest research ledger (unique session/request, run reference/accepted_at, one-hour quota retention) and one-hour hashed bootstrap buckets; retain run/receipt identity guards and prevent cleanup cascades into durable history.
- [X] T013 Add precise Kysely table mappings in `web/server/db/types.ts` and `web/server/db/database.ts` and narrow Zod storage-boundary schemas in `web/server/db/planning-schema.ts` matching migrations/data-model exactly; distinguish planning principal IDs from registered account IDs without TypeScript any.
- [X] T014 Implement default-account principal backfill/lazy allocation, dedicated wizard-principal allocation and current access queries in `web/server/db/planning-principal-repository.ts`; account non-default drafts link immediately, guest-origin principals retain provenance and cannot transfer or revert after linking.
- [X] T015 Implement opaque session creation/read/renew/revoke in `web/server/auth/planning-session.ts`: 32 random bytes/base64url, hashed storage, HttpOnly/host-only/Path=/SameSite=Lax, Secure production __Host-onholidai-planning and local onholidai-planning-dev; renew only valid authority to now+30 days, keep guest proof through auth, never log credentials.
- [X] T016 Implement server-produced PlanningActor and BookingActor in `web/server/auth/planning-actor.ts` and `web/server/auth/authorize.ts`; resolve requested resource owner, prove current session/account binding, require registered account/principal relation for booking, keep internal team checks separate and deny unknown resources without content.
- [X] T017 Integrate planning-specific response/actor helpers into `web/server/api.ts` and `web/server/errors.ts`; preserve browserUser as account-only, exact Origin checks, JSON/request limits, correlation IDs and private/no-store, implement specified safe guest/draft/link/quota error codes and bounded field validation.
- [X] T018 Introduce composable transaction access/lock helpers in `web/server/db/planning-access.ts` and `web/server/db/transaction.ts`; enforce session/quota guard→principal→draft→trip→run→existing mutation/booking lock order, recheck authority before private replay/commit, and avoid nested transactions or out-of-order quota scans.
- [X] T019 Update planning-owner reads/commit audit attribution in `web/domain/trip/read.ts`, `web/domain/trip/commit.ts`, `web/server/db/trip-repository.ts` and `web/server/db/idempotency-repository.ts`; retain existing fingerprints/owner keys/version/undo/provider-write exclusion and require current principal access before replay.
- [X] T020 Run foundational migration/actor/legacy contract checks using `web/tests/integration/migration-compatibility.test.ts`, `web/tests/unit/planning-actor.test.ts` and `specs/002-platform-guest-planning/quickstart.md`; record real results/skips in `specs/002-platform-guest-planning/evidence/foundation.md` and do not expose guest stories until compatible foundation passes.

**Checkpoint**: Complete the stated gate before advancing; do not mark unfinished implementation or missing external evidence complete.

---

## Phase 3: User Story 1 — Start with Destinations and Build a Guest Estimate (P1, MVP)

**Goal**: Deliver public globe-first setup with recoverable partial drafts and explicit guest estimate acceptance.

**Independent Test / Checkpoint**: Fresh signed-out context selects country/two cities, reorders/replaces, completes valid confirmed-origin setup, requests/reviews/accepts estimate and reloads same accepted trip; map-disabled equivalent passes.

### Tests

- [X] T021 [P] [US1] Write session/draft/filtered-places endpoint contract cases in `web/tests/contract/guest-setup-api.test.ts` for request/envelope/status shapes, partial versus full validation, same-origin/private headers, duplicate replay and inaccessible draft denial.
- [X] T022 [P] [US1] Write isolated draft revision/submit cases in `web/tests/integration/setup-drafts.test.ts` for account/guest dedicated principals, committed saves, tab conflicts, repeated submit, lost reservation response, one-trip attachment and terminal-run fresh-request retries.
- [X] T023 [P] [US1] Write initial-estimate guest browser cases in `web/tests/e2e/guest-setup.spec.ts` for country/city add/remove/reorder/replace, confirmed origin, step back/refresh, missing child age/date validation, explicit acceptance and full map-failure keyboard fallback.
### Implementation

- [X] T024 [US1] Implement bounded incomplete-input schema in `web/components/trip-setup/draft-schema.ts`: preserve verbatim limits "title up to 120 characters, empty until review", "zero-to-eight canonical destinations", "up to 32 availability windows with empty dates", "nullable numeric duration inputs", "existing ten-traveller limit with missing child ages", "five integer 0–100 preferences", "up to 64 requirements, wording up to 1000 characters, empty until submit" and "Missing numeric value is null, not age zero"; require full existing domain schema only on submit.
- [X] T025 [US1] Implement draft allocate/read/revision-save and owner-scoped creation receipts in `web/server/db/setup-draft-repository.ts`; preserve server-assigned immutable creation/research IDs, unique dedicated principal, same-request replay, submitted-draft rejection and no silent merge.
- [X] T026 [US1] Implement account-or-guest POST bootstrap and protected cookie delivery in `web/app/api/v1/planning-session/route.ts`, reusing `web/server/auth/planning-session.ts`; Server Components remain read-only, expired cookies create fresh authority only and failed initialization cannot claim persistence.
- [X] T027 [US1] Implement draft POST/GET/PATCH routes in `web/app/api/v1/setup-drafts/route.ts` and `web/app/api/v1/setup-drafts/[draftId]/route.ts`; enforce partial schema, owner/revision/idempotency/private checks and specified 404/409/422 behavior.
- [X] T028 [US1] Implement atomic valid submission in `web/server/db/setup-draft-repository.ts`, `web/domain/trip/create.ts` and `web/app/api/v1/setup-drafts/[draftId]/submit/route.ts`; create/attach one trip using immutable creation request, full confirmed-origin/domain validation, return same trip/research ID on replay and forbid new trips from submitted drafts.
- [X] T029 [US1] Extend canonical lookup/filter behavior in `web/server/supply/places.ts`, `web/server/supply/read.ts`, `web/server/supply/providers/synthetic.ts` and `web/app/api/v1/places/route.ts`; allow bounded empty query only for country-restricted city requests, validate ISO/kind filters and implement existing live/deterministic adapter equivalents without a new provider or guessed timezone.
- [X] T030 [US1] Implement shared destination actions and accessible candidate/list replacement in `web/components/trip-setup/destinations.tsx` and `web/components/map/destination-picker.tsx`; max eight, reject exact duplicates, allow country plus distinct same-country cities, preserve replacement slot/route order, retain missing-coordinate entries and clarify ambiguity.
- [X] T031 [US1] Build `web/components/map/destination-globe.tsx` using installed MapLibre globe projection/local countries/vendored worker and existing attribution; one mounted map, source/filter updates, country feature lookup/city candidate points, ResizeObserver/cleanup, no ocean/geographic identity guessing and immediate non-map retry fallback.
- [X] T032 [US1] Implement session/draft bootstrap, query-target recovery and serialized 500-ms autosave in `web/components/trip-setup/use-setup-draft.ts` and `web/components/trip-setup/http.ts`; committed-save status, retained offline edits, revision reload/compare, stale-response protection and flush-before-submit, no browser-only accepted state.
- [X] T033 [US1] Refactor setup fields into composable focused steps in `web/components/trip-setup/setup-form.tsx`, `availability.tsx`, `party-preferences.tsx` and `constraints.tsx`; reuse existing confirmed-origin/date/duration/party/preference/requirement semantics, preserve all entered data and contextual dependent-field errors.
- [X] T034 [US1] Add desktop persistent/mobile expandable trip summary and step progress/back/continue in `web/components/trip-setup/setup-summary.tsx` and `setup-progress.tsx`; preserve title/currency and six-step order, explicit error/heading focus, live saving status, keyboard labels and unobstructed controls.
- [X] T035 [US1] Make `web/app/trips/new/page.tsx` public and compose the globe-first wizard with session initialization/recovery states; preserve same route across steps, expose search/list immediately and never redirect visitors to sign-in for planning.
- [X] T036 [US1] Route initial trip/run/proposal operations through current PlanningActor in `web/app/trips/[tripId]/page.tsx`, `web/app/api/v1/trips/[tripId]/route.ts`, `web/app/api/v1/trips/[tripId]/agent-runs/route.ts`, `web/app/api/v1/agent-runs/[runId]/route.ts`, `web/app/api/v1/agent-runs/[runId]/clarifications/route.ts` and proposal accept/reject route files; keep full workspace guest refinements deny-by-default until US2 and all bookings account-only.
- [X] T037 [US1] Implement PostgreSQL session-wide research/creation limits in `web/server/metrics/guest-planning.ts` and `web/server/config.ts`, integrate `web/server/agent-client/run-repository.ts` and session bootstrap: two active/ten new runs-hour, twenty new sessions-hour per secret-hashed network key, replay free, atomic quota/run reservation, Retry-After, safe one-hour bucket expiry and no raw address/secret logging.
- [X] T038 [US1] Add current-principal/unrevoked-run checks to every internal planning read/write via `web/server/api.ts`, `web/server/agent-client/run-repository.ts` and the internal trip/context/run route files listed in `evidence/route-access.md`; preserve signed owner/trip/request/version/audience/scopes, receipt fingerprints, no cursor-gap partial writes and legacy account grant compatibility.
- [X] T039 [US1] Integrate submission→initial reservation→existing estimate review in `web/components/trip-setup/setup-form.tsx`, `web/components/trip-workspace/estimate-summary.tsx` and `web/server/agent-client/client.ts`; missing response replays original request, terminal failed/revoked research uses fresh persisted request on same trip, explicit acceptance only, safe guest expiry/quota/error recovery and unchanged customer pricing labels.
- [X] T040 [US1] Run US1 contract/integration/browser plus existing estimate/booking-denial/accessibility checks using `web/tests/e2e/guest-setup.spec.ts` and `web/tests/integration/estimate.test.ts`; record evidence including zero reservations/payments and same-browser reload in `specs/002-platform-guest-planning/evidence/us1.md`; keep unsupported guest booking gated.

**Checkpoint**: US1 is complete only when its independent checks and relevant existing regressions pass; record actual evidence.

---

## Phase 4: User Story 2 — Continue and Refine a Private Guest Trip (P1)

**Goal**: Extend private recoverable guest authority through full refinement/history/undo/finalization and all event feeds.

**Independent Test / Checkpoint**: Seed accepted guest estimate, refine/accept/undo/finalize, reload consistent panes; unrelated/expired sessions fail every resource/history/stream attempt.

### Tests

- [ ] T041 [P] [US2] Write owner-access matrix contract cases in `web/tests/contract/guest-planning-api.test.ts` covering trips/versions/events/conversations/proposals/edit-preview/edit/undo/finalize/runs/clarifications and guest denial for booking/internal pricing/provider callbacks.
- [ ] T042 [P] [US2] Write seeded guest refinement/replay/outage/expiry/quota scenarios in `web/tests/integration/guest-planning.test.ts`; assert same accepted history, unrelated-identifier denial, cross-pane version convergence, stale-proposal atomic rejection and no side effects.
- [ ] T043 [P] [US2] Write guest refine/history/undo/finalize/map-outage browser journey in `web/tests/e2e/guest-planning.spec.ts` with empty guest contexts, separate unrelated account/guest contexts and clear access-expired outcomes.
### Implementation

- [X] T044 [US2] Extend trip versions/conversations/edit-preview/edit/undo/finalize and run-event route families in `web/app/api/v1/trips/[tripId]/versions/route.ts`, `conversations/route.ts`, `commands/edit-preview/route.ts`, `commands/edit/route.ts`, `commands/undo/route.ts`, `commands/finalize/route.ts` and `web/app/api/v1/agent-runs/[runId]/events/route.ts` using current PlanningActor, preserving impact/feasibility/undo and registered-only transactions.
- [X] T045 [US2] Align principal-scoped proposal/conversation/run reads and mutations in `web/server/db/proposal-repository.ts`, `web/server/db/conversation-repository.ts`, `web/server/db/version-history.ts`, `web/domain/trip/edit.ts`, `web/domain/trip/accept-proposal.ts` and `web/domain/trip/finalize.ts`; preserve immutable snapshot/history and authorization invalidation boundaries.
- [X] T046 [US2] Recheck live guest/account authority before private event delivery in `web/app/api/v1/trips/[tripId]/events/route.ts` and `web/app/api/v1/agent-runs/[runId]/events/route.ts`; safely close on expiry/link/revoke, retain private/no-store and allow owner-scoped cursor recovery without stream-wide long-held locks.
- [X] T047 [US2] Update `web/components/trip-workspace/workspace.tsx`, `use-trip.ts`, `use-trip-events.ts`, `web/components/agent/conversation.tsx` and `clarification.tsx` for guest expiry/retry/limit states and recorded evidence recovery without account gates, automatic proposal application or reset of entered/accepted data.
- [X] T048 [US2] Adapt principal-aware customer exports/deletion/legal holds and partial-draft retention review in `web/server/privacy/export-delete.ts` and `retention.ts`; preserve "90-day raw messages and 24-month trip/partial-draft review", no expiry-triggered evidence deletion, account-only team roles and no cascading session cleanup.
- [X] T049 [US2] Add privacy/retention and research-limit replay/clock regression cases in `web/tests/integration/retention.test.ts` and `web/tests/integration/guest-planning.test.ts`; prove expired guest access leaves accepted versions and legal holds intact and concurrency counts release on terminal/interrupted runs.
- [X] T050 [US2] Audit and complete every planning-route/receipt access entry in `specs/002-platform-guest-planning/evidence/route-access.md` against implementation; leave booking/service diagnostic/provider boundaries protected and preserve legacy account behavior.
- [X] T051 [US2] Run US2 seeded integration/browser plus existing refinement/finalization/pricing/history suites in `web/tests/integration/refinement.test.ts`, `finalization.test.ts` and `pricing-disclosure.test.ts`; record ownership/outage/accessibility/version/zero-side-effect evidence in `specs/002-platform-guest-planning/evidence/us2.md`.

**Checkpoint**: US2 is complete only when its independent checks and relevant existing regressions pass; record actual evidence.

---

## Phase 5: User Story 3 — Create a Free Account at Booking and Resume Safely (P1)

**Goal**: Link exactly the selected guest trip to a free account, resume booking review, and preserve registered account authorization across distinct principal IDs.

**Independent Test / Checkpoint**: Seed eligible guest trip(s), complete sign-in/sign-up, repeat/link concurrently and recover failed response; same trip/history, one owner, no auth-triggered booking, dual-identity worker checks pass.

### Tests

- [ ] T052 [P] [US3] Write intent/link/auth contract cases in `web/tests/contract/booking-auth-api.test.ts`: fixed-action safe paths, POST-only linking, account+guest proof, 30-minute pending expiry, consumed same-account replay after cookie expiry, conflicting request/other-account denial and no financial consent.
- [ ] T053 [P] [US3] Write isolated concurrent-claim/save/link/callback/replay/active-run scenarios in `web/tests/integration/account-linking.test.ts`; compare unchanged snapshots/versions/fingerprints, one selected owner, retained unrelated trips/results/proposals, revoked old grants and zero booking records/provider writes.
- [ ] T054 [P] [US3] Write account!=principal booking domain/worker/route cases in `web/tests/integration/booking-planning-identity.test.ts` and auth-boundary browser cases in `web/tests/e2e/booking-auth.spec.ts`; cover all book/status/recover/cancel/reschedule operations plus cancel/back/existing-email/sign-out/safe return paths.
### Implementation

- [X] T055 [US3] Implement typed BookingIntent/link request schemas and durable receipt queries in `web/server/auth/booking-intent.ts` and `web/server/db/planning-link-repository.ts` matching migration constraints verbatim: "Sole value review_booking, never execution/payment", "pending, consumed, expired", "Required timestamps; pending lifetime 30 minutes", "Account FK/time, both present exactly when consumed", "Unique/primary principal FK; one successful guest binding" and "Required timestamp / positive audit version; no version advance"; stable fingerprint replay and derived paths only.
- [X] T056 [US3] Implement current-ownership/capability-checked intent creation in `web/app/api/v1/booking-intents/route.ts` and `web/server/auth/booking-intent.ts`; guest selected trip only, account-owned route shortcut, original-session proof and fixed-action intent, no provider/workflow invocation.
- [X] T057 [US3] Implement atomic selected-principal link in `web/server/auth/link-trip.ts`: session-first lock order, account+guest proof, account binding/guest clearing, draft revision advance, append-only receipt/audit and intent consumption; same-account retry/other-account denial and no owner/history/request/terms/version rewrite.
- [X] T058 [US3] Integrate all-pre-link run revocation/active interruption into `web/server/agent-client/run-repository.ts` and `web/server/auth/link-trip.ts`; set nullable revocation once, close leases/fail active runs as interrupted, retain completed results/proposals/expiry and invalidate old internal grants before response.
- [X] T059 [US3] Expose POST link and safe GET continuation/retry UI in `web/app/api/v1/booking-intents/[intentId]/link/route.ts`, `web/app/auth/continue/page.tsx` and `web/components/auth/booking-continuation.tsx`; derive authorized current nextPath, preserve successful link on eligibility changes, replay consumed receipts to same account after cookie expiry and never mutate on GET.
- [X] T060 [US3] Add Better Auth signUpEmail wrapper with current locale/currency/password policy to `web/server/auth/auth.ts` and reusable themed pending/error auth form in `web/components/auth/auth-form.tsx`; preserve cookie proof and no custom password storage, subscription or payment fields.
- [X] T061 [US3] Implement free `web/app/(auth)/sign-up/page.tsx` and update `web/app/(auth)/sign-in/page.tsx` with name/email/password validation, existing-account sign-in path, intent-first safe continuation, optional ordinary local redirect, cancel/back progress and sign-out behavior without guest access to linked trips.
- [X] T062 [US3] Implement explained sign-in/free-sign-up/back-to-planning boundary in `web/components/auth/booking-boundary.tsx`, `web/components/trip-workspace/price-bar.tsx` and `web/app/trips/[tripId]/booking/page.tsx`; enforce direct guest booking entry and existing finalized/capability prerequisites, no estimate or auth treated as consent.
- [X] T063 [US3] Carry validated BookingActor through `web/domain/booking/revalidate.ts`, `authorize.ts`, `start.ts` and `reschedule.ts`; principal for trip read/lock, actual account for booking owner/fingerprint/authorization/execution basis, relation recheck under transaction and unchanged terms/expiry/write-exclusion/duplicate guarantees.
- [X] T064 [US3] Apply dual identity to every booking/status/revalidation/component route in `web/server/booking/routes.ts`, `web/app/api/v1/bookings/[bookingId]/route.ts`, `web/app/api/v1/booking/revalidations/[workflowId]/route.ts`, trip booking revalidation/authorization/start routes and component recovery/cancellation/reschedule route files enumerated in `evidence/route-access.md`; guests remain denied even by direct requests.
- [X] T065 [US3] Validate execution account→principal relationship in `web/server/workflows/book-activities.ts`, `revalidate-activities.ts` and `web/domain/booking/apply-outcomes.ts`; use stable principal for outcome commits and account for immutable booking basis, preserve original transaction evidence/hashes, provider write serialization and existing logout/expiry behavior.
- [X] T066 [US3] Update post-link owner UI/reconnect/research retries in `web/components/trip-workspace/use-trip.ts`, `use-trip-events.ts`, `estimate-summary.tsx` and `web/components/agent/conversation.tsx`; stop old guest streams, recover account evidence, fresh request for interrupted/revoked research on same trip, no proposal expiry reset or automatic acceptance.
- [ ] T067 [US3] Extend account-linking/dual-identity regressions in `web/tests/integration/account-linking.test.ts`, `booking-planning-identity.test.ts` and `booking-authorization.test.ts` for simultaneous quota/link/callback locks, price/material edits while authenticating, duplicate/unknown outcomes and exact-term reauthorization.
- [ ] T068 [US3] Complete route access/registration claims and migration deployment gate in `specs/002-platform-guest-planning/evidence/route-access.md` and `quickstart.md`; confirm compatible account/guest web and worker versions before enabling booking for linked principals.
- [X] T069 [US3] Run US3 contract/DB/browser plus Temporal/authorization/privacy/partial-failure regressions in `web/tests/integration/booking-workflows.test.ts` and `web/tests/e2e/booking-auth.spec.ts`; document same-trip linking, zero auth/link side effects and all booking operation results in `specs/002-platform-guest-planning/evidence/us3.md`.

**Checkpoint**: US3 is complete only when its independent checks and relevant existing regressions pass; record actual evidence.

---

## Phase 6: User Story 4 — Understand the Product from the Homepage (P2)

**Goal**: Explain supported AI multi-destination planning and make public planning easy to discover.

**Independent Test / Checkpoint**: Anonymous visitor identifies value/process/free planning/CTA and follows planning/auth routes; examples/claims are truthful and no builder/session bootstrap appears.

### Tests

- [X] T070 [P] [US4] Write homepage CTA/navigation/illustrative-content/claim/browser checks in `web/tests/e2e/homepage.spec.ts`; assert public access, no embedded builder/session bootstrap, meaningful image alternatives and links only to enabled routes.
### Implementation

- [X] T071 [US4] Build reusable marketing hero/process/benefits and explicitly illustrative itinerary cards in `web/components/marketing/hero.tsx`, `process.tsx` and `itinerary-example.tsx` using shared shadcn/tokens; use examples instead of new imagery where sufficient, and document rights/alt text if imagery is added.
- [X] T072 [US4] Replace minimal `web/app/page.tsx` with clear value proposition/prominent /trips/new CTA, how-it-works, travel examples, supported trust/benefit copy and account-free planning; remove stale booking copy and avoid savings/provider/endorsement guarantees without evidence.
- [X] T073 [US4] Integrate simple planning/sign-in/free-sign-up navigation and coherent metadata in `web/components/marketing/navigation.tsx` and `web/app/layout.tsx`; preserve landmarks/skip link, avoid homepage guest initialization, gate unfinished auth links if developing this phase early.
- [X] T074 [US4] Run homepage/browser/keyboard checks using `web/tests/e2e/homepage.spec.ts`; record claim source/optional asset rights and measured SC-001 results when participants are available in `specs/002-platform-guest-planning/evidence/us4.md`, leaving unavailable participant evidence explicitly pending.

**Checkpoint**: US4 is complete only when its independent checks and relevant existing regressions pass; record actual evidence.

---

## Phase 7: User Story 5 — Plan Comfortably Across Devices and Access Needs (P2)

**Goal**: Finish cohesive responsive states and useful restrained motion without compromising existing interactions.

**Independent Test / Checkpoint**: All routes pass mobile/desktop, keyboard/screen-reader/zoom/forced-color/reduced-motion checks across normal/failure states; controls respond immediately.

### Tests

- [ ] T075 [P] [US5] Write responsive/state/focus/motion browser cases in `web/tests/e2e/platform-ux.spec.ts` for 320/390/768/1440 pixels, 200% zoom, loading/empty/error/conflict/research/link states, no overlay/overflow, keyboard fallback and animation-independent interaction.
### Implementation

- [X] T076 [US5] Finish typography/spacing/hierarchy/responsive summaries and safe sticky totals in `web/app/globals.css`, `web/components/trip-setup/setup-summary.tsx` and `web/components/trip-workspace/workspace.tsx`; use existing semantic tokens and shadcn source, min 44×44 targets and contrast/forced-color preservation.
- [X] T077 [US5] Unify understandable loading/empty/saved/unsaved/success/error and focus announcements in `web/components/ui/status-announcer.tsx`, `web/components/ui/accessible-field.tsx`, `web/components/trip-setup/setup-form.tsx` and `web/components/auth/booking-continuation.tsx`; preserve values/retry actions and recognizable map/chat/history/price functions.
- [X] T078 [US5] Add brief non-blocking CSS entrance/selection/step feedback in `web/app/globals.css` and explicit reduced-motion camera behavior in `web/components/map/destination-globe.tsx`; no automatic rotation or exit wait, do not add Motion merely for fades; document any demonstrated optional list-layout benefit/dependency decision in `specs/002-platform-guest-planning/evidence/motion.md` before introducing it.
- [ ] T079 [US5] Perform manual keyboard/screen-reader/zoom/forced-color/reduced-motion journey checks and correct implementation failures in the affected `web/components/` files; record focus/list/dialog/heading/error/contrast behavior and viewport screenshots in `specs/002-platform-guest-planning/evidence/accessibility.md`.
- [ ] T080 [US5] Run US5 browser/state tests and measure <=1-second deterministic input acknowledgement/no-animation-wait; record actual results plus pending/measured participant SC-010 ratings in `specs/002-platform-guest-planning/evidence/us5.md`.

**Checkpoint**: US5 is complete only when its independent checks and relevant existing regressions pass; record actual evidence.

---

## Phase 8: Polish & Cross-Cutting Release Gates

**Goal**: Close requirements coverage, regression, rollout and user-outcome evidence after implemented stories.

**Independent Test / Checkpoint**: Full quickstart matrix and all mandatory safeguards pass; missing external/manual evidence remains explicitly open, never marked complete.

- [X] T081 Audit all FR-001–FR-029 and SC-001–SC-010 coverage against generated tests/evidence in `specs/002-platform-guest-planning/evidence/coverage.md`; trace every route/actor/constraint, preserve existing pricing/feasibility/domain rules and close code issues rather than treating a checklist as implementation evidence.
- [ ] T082 Validate fresh/upgrade schema, guest/account direct/draft creation, existing snapshots/receipts/hashes and non-destructive feature-disable rollout using `web/tests/integration/migration-compatibility.test.ts`; record compatible web/agent/worker deployment and recovery steps in `specs/002-platform-guest-planning/evidence/rollout.md`.
- [X] T083 Run complete lint/type/unit/integration/contract/migration/Temporal/browser/build commands from `specs/002-platform-guest-planning/quickstart.md`, including original trip/booking regressions and agent checks when affected; record actual failures/skips/results in `specs/002-platform-guest-planning/evidence/release.md`, do not count missing isolated DB or browsers as success.
- [ ] T084 Execute frozen participant tasks with the specified cohort when available and record anonymized actual timings/denominators/ratings for SC-001/002/003/007/010 in `specs/002-platform-guest-planning/evidence/usability.md`; if participants are unavailable, leave this task unchecked and report the outstanding release gate instead of fabricating completion.
- [X] T085 Verify customer pricing/private data minimization and session/network-bucket/raw-message cleanup through `web/tests/integration/booking-privacy.test.ts`, `pricing-disclosure.test.ts` and `retention.test.ts`; record no guest credential/address leak, no diagnostic cost exposure and no expiry-triggered accepted-history deletion in `specs/002-platform-guest-planning/evidence/privacy.md`.
- [X] T086 Reconcile final implemented commands/contracts and documented safe defaults in `specs/002-platform-guest-planning/quickstart.md`, `contracts/planning-api.md`, `contracts/ui-contract.md` and `README.md`; summarize measured readiness and any explicit outstanding acceptance gates without expanding feature scope.

**Checkpoint**: Complete the stated gate before advancing; do not mark unfinished implementation or missing external evidence complete.

---

## Dependencies & Execution Order

### Phase dependencies

```text
Setup T001–T005
  -> Foundation T006–T020
     -> US1 T021–T040 -> US2 T041–T051 -> US3 T052–T069
     -> US4 T070–T074 (static work may start after foundation;
                       final auth/navigation checks require US3 routes)
     -> US5 T075–T080 (integrated implementation requires US1–US4)
        -> Release T081–T086
```

Use the listed phase order by default. US2 and US3 can be tested with seeded accepted/finalized trips instead of rerunning earlier UI, but their integrated access paths reuse prior delivered behavior. US4 can prepare marketing after foundation; do not advertise unimplemented auth/booking routes. US5 tests may be authored from the contract early, but its full-route verification waits for all journeys. Release task T084 stays open if its participant cohort is unavailable.

### Ready batches and critical task dependencies

| Ready batch / task chain | Prerequisites and constraints |
| --- | --- |
| T001→T002→T003→T004→T005 | Freeze evidence, configure helpers, theme, components and route inventory in order. |
| T006 + T007 | Parallel test authoring after setup; distinct test files, shared completed fixture conventions. |
| T008→T009→T010→T011→T012→T013 | Ordered migration 011/012 edits (same files are never parallel), then types. Session table precedes principal FK. |
| T014→T015→T016→T017→T018→T019→T020 | Principal repository, session, actors, API, locks, domain/replay adaptation, then foundation gate. |
| T021 + T022 + T023 | Parallel US1 test authoring after T020; no implementations until new cases exist. |
| T024→T025→T026→T027→T028 | Partial schema/repository/session/draft endpoints before atomic submission. |
| T029→T030→T031 | Canonical country/city lookup before shared actions and globe. |
| T032→T033→T034→T035 | Draft hook before composable steps/summary/public builder. |
| T036→T037→T038→T039→T040 | Initial guest route integration, atomic limits/run access, estimate integration then MVP gate. Guest entry is not exposed until these protections pass. |
| T041 + T042 + T043; then T044→…→T051 | Parallel US2 tests after US1 checkpoint; remaining guest routes/repos/streams/UI/privacy then gate. |
| T052 + T053 + T054; then T055→…→T069 | Parallel US3 tests after US2 checkpoint; intent/repository→link→revocation→route/UI→auth→boundary→booking domain/routes/workers→account recovery→regressions/gate. |
| T070; then T071→T072→T073→T074 | Marketing test first; source/components/page/navigation and evidence. Final auth links require T060–T062, booking claims require T069. |
| T075; then T076→T077→T078→T079→T080 | Responsive/state tests then cohesive layouts/status/motion and manual/gate evidence, after complete journeys. |
| T081→T082→T083→T084→T085→T086 | Coverage, upgrade/rollout, full checks, actual participants, privacy and final docs. Missing participant evidence is a release gap, not a reason to discard completed code. |

T008–T012 form one reviewed migration set; do not run a half-authored migration. T019/T028 and run reservation must compose in an existing transaction rather than open nested transactions. T037 allocates quota and run atomically under session-first locking. T038 is required before guest research delivery and before T058 can revoke grants. T057–T058 and intent/receipt updates execute in one atomic linking transaction. T063–T065 must all be complete before enabling booking for account-linked principals whose IDs differ. Existing provider-write locks/material-change invalidation stay active throughout.

### Parallel opportunities and examples per story

Only thirteen tasks are marked [P]. These are independent test-authoring opportunities, not authorization to spawn agents or edit shared files concurrently.

| Story | Example ready parallel work |
| --- | --- |
| US1 | After T020, author T021 contract, T022 database and T023 browser cases together; implementation waits for authored failing cases. |
| US2 | After T040, author T041 access contract, T042 seeded recovery and T043 browser journey together. |
| US3 | After T051, author T052 intent/auth contracts, T053 races and T054 booking/browser identity cases together. |
| US4 | T070 homepage test authoring can run alongside T075 UI-contract test authoring once foundation and fixtures are ready; its implementation/navigation gates still follow the dependencies above. |
| US5 | T075 viewport/state/motion cases can run alongside T070 homepage cases; different test files and neither relies on the other's incomplete implementation. Full US5 execution requires all implemented journeys. |

Foundation T006 and T007 can also be authored together. Unmarked implementation tasks remain serial because migrations, shared theme/API/repositories and story integrations overlap. If later splitting implementation work, first establish complete dependencies and exclusive files rather than infer independence from story labels.

## Requirements and Outcome Traceability

| Requirement group | Delivering tasks / mandatory evidence |
| --- | --- |
| FR-001 marketing | T070–T074; SC-001 participant evidence T001/T074/T084. |
| FR-002–FR-004 globe/destinations | T023/T029–T031/T035/T040; SC-003 and fallback T079/T084. |
| FR-005–FR-008 steps/setup/origin | T024–T028/T032–T035/T039–T040; SC-002/004 evidence. |
| FR-009–FR-011 planning/acceptance/pricing | T036–T040/T041–T051/T085; preserve original proposal/version/customer-price regressions. |
| FR-012–FR-016 sessions/persistence/isolation/limits | T006–T020/T021–T028/T036–T038/T041–T050; SC-004/005 plus expiry/replay/quota cases. |
| FR-017–FR-018 booking-only auth/free sign-up | T052/T054/T060–T063/T069; SC-007 participant task T084. |
| FR-019–FR-023 linking/continuation/access recovery | T053/T055–T059/T061/T066–T069; SC-005/006 race/replay and old-credential checks. |
| FR-024 transaction safety | T007/T020/T040/T051/T054/T063–T065/T067/T069/T083; SC-008 exact-term/duplicate/partial-failure tests. |
| FR-025–FR-028 theme/states/accessibility/motion | T002–T004/T030–T035/T060–T062/T070–T080; SC-009 and actual SC-010 timing/ratings. |
| FR-029 legacy compatibility | T006/T008–T020/T048–T049/T063–T069/T082–T083/T085. |
| All SC-001–SC-010 gates | Freeze T001; phase evidence T040/T051/T069/T074/T079–T080; coverage T081 and actual release/participant results T083–T085. |

Every stated acceptance scenario must be covered by the corresponding story test/evidence, including denial, interrupted, expired, concurrent and repeated paths. SC-004–SC-008 require 100% of frozen regression cases, not a happy-path demonstration. SC-001/002/003/007/010 participant thresholds remain as specified; manual assistive technology is required even if automated browser assertions pass.

## Implementation Strategy

### Current handoff (2026-10-15, verification pass)

Story source is delivered and now executes on the reviewed lockfile with Node.js 24.21.0,
pnpm 12.11.2, Docker Desktop 29.6.1, an isolated PostgreSQL/PostGIS instance and the real
deterministic agent. Verified: web lint/typecheck, repo lint/typecheck (including ruff and
pyright), `pnpm --dir web test` with **283 tests passing and no skips**, `pnpm --dir web
test:e2e` with **82 browser journeys passing across five projects**, the production build,
75 agent tests and the cross-language contract checks. See
evidence/implementation-status.md and evidence/release.md for commands and results.

Eight defects were found by running the stack and fixed: the dropped
`internalPlanningApiResponse` options (typecheck failure), an ambiguous `session_count`
upsert that made every guest bootstrap return 500, a key-order-sensitive payload comparison
that looped autosave and lost drafts, initial-load focus stealing from the skip link, an
empty `requiredScopes` list that returned 401 on every agent→web callback, a nested
transaction that broke conversation history, a fieldset min-content overflow, and a lost
price-bar landmark. Each is covered by the passing suites above.

T021–T023 and T049 were completed, and the execution gates T040/T051/T069/T074/T083/T085
now have real results rather than skips. Still open: T041–T043, T052–T054, T067, T075 (their
suites exist and pass but the exhaustive scenario lists are not fully covered — see
evidence/coverage.md), T068 (blocked by a pre-existing booking-worker entrypoint defect),
T079 (manual assistive-technology review), T080 (SC-010 timing) and T084 (participants).


### MVP first (US1)

Complete T001–T020, then T021–T040. Demonstrate fresh guest globe/search setup, persisted back/refresh, valid confirmed origin, research review/explicit acceptance and reload with zero reservation/payment. Maintain account-only booking gates and keep unsupported guest refinement routes denied until their checks pass. This is the smallest coherent useful increment; it does not claim the entire feature is complete.

### Incremental delivery

Deliver US2 private refinement/history/recovery, then US3 selected-trip free authentication and safe booking identity. Deliver US4 marketing and US5 presentation/accessibility/state finishing, maintaining earlier invariants. Static marketing may be prepared earlier with truthful enabled-capability copy. Run relevant regression/type/lint/migration/accessibility checks at each checkpoint and the full quickstart matrix at release. Record real evidence; incomplete participant/manual environments remain explicit unfinished gates.

### Notes

There are 86 tasks: 5 setup, 15 foundation, US1 20, US2 11, US3 18, US4 5, US5 6, and 6 release tasks. All tasks have unique sequential IDs, exact path targets and correct phase/story tags. No tasks require new accounts/subscriptions/providers for planning. Motion is optional only for demonstrated layout value; tests retain immediate interactions and reduced motion. This document is an implementation backlog, not completed implementation or release approval.
