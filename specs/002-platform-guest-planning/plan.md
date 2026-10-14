# Implementation Plan: Platform UX, Guest Planning & Account Creation

**Branch**: `main` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: The feature specification and user direction to reuse the stack, use shadcn/ui and existing theme tokens, and consider Motion where useful.

The setup script resolves this feature but reports a feature-derived branch name; the actual Git branch is `main`. No branch or runtime changes are part of planning.

## Summary

Create marketing at `/` and public globe-first persisted setup at `/trips/new`, continuing through existing estimate/workspace routes. Introduce private guest sessions and stable planning principals in PostgreSQL, linking only the selected guest trip's principal to a free registered account at booking. Preserve owner keys, version/run identities, proposal acceptance and exact-term booking safeguards.

Use source-owned Radix shadcn components and existing CSS tokens. Reuse MapLibre globe projection, local country data, canonical place lookup and the vendored worker. CSS suffices for basic transitions; Motion is evaluated and deferred unless a demonstrated destination-list layout need justifies it.

## Technical Context

**Language/Version**: Node.js 24, TypeScript 6.0.3, React 19.3.0, Next.js 16.4.0; existing Python 3.13 agent.

**Primary Dependencies**: Existing Better Auth 1.7.7, Kysely 0.29.6, pg 8.23.1, Zod 4.6.5, MapLibre 6.13.0, Radix UI 1.7.0, Tailwind 4.3.3, React Day Picker 10.0.2, TanStack React Query 5.104.1, Temporal 1.24.0. Add only source-required `class-variance-authority`, `clsx`, `tailwind-merge` and matching `@tailwindcss/postcss` for the missing v4 pipeline; pin reviewed versions/lockfile during implementation. No initial Motion dependency or replacement technology.

**Storage**: PostgreSQL 18/PostGIS, existing `app` schema. Add migrations after 010 for principals/sessions, partial drafts, intents/link receipts, quota records and run-access revocation. Preserve snapshots, receipts, outbox and immutable evidence.

**Testing**: Existing Vitest/Testing Library, isolated PostgreSQL/migration fixtures, Playwright desktop/mobile projects, contracts, pytest and deterministic agent/provider doubles. Add isolation, draft conflict, linking/race/replay and dual-identity booking coverage. Manual assistive-technology and participant checks remain release gates.

**Target Platform**: Existing Node BFF, Python agent and booking worker on host/container infrastructure; desktop/mobile including non-WebGL fallback.

**Project Type**: Existing web application/BFF; no new service.

**Performance Goals**: Acknowledge input within one second; preserve 95/100 deterministic estimates within 30 seconds. Draft save debounce 500 ms with committed-save feedback. One globe instance, source updates in place, and no navigation delayed by decorative exits.

**Constraints**: Existing destination/date/party/constraint limits, confirmed origin, explicit acceptance, private owner scope, guest expiry after 30 days idle, 90-day raw-message expiry and 24-month record review; 320-pixel/200%-zoom layouts, 44-pixel controls, compatible migrations and exact-term consent.

**Scale/Scope**: Five stories, 29 requirements, ten success criteria; unchanged existing capacity commitments. Guest research defaults to two active runs and ten distinct new runs/hour/session, replay free. Sharing, cross-device guest recovery, social auth, subscriptions, new providers and changed domain limits are excluded.

## Constitution Check

Pre-research and post-design gates pass without exceptions. These are design checks, not executed implementation-test evidence.

| Principle | Evidence / implementation gate |
| --- | --- |
| I. Small modules | Focused session/principal/draft/link modules compose existing repositories; no universal framework or service. |
| II. Explicitness | Typed PlanningActor and BookingActor, strict schemas, injected clock/randomness and no TypeScript any. |
| III. Accessibility | Equivalent search/list, focus/status contracts, Radix primitives; required keyboard/screen-reader/contrast/zoom/motion evidence. |
| IV. Context budget | Existing compact agent state/wire identity; no session secrets or extra default model context. |
| V. Behavioral tests | Prove isolation, recovery, races/replay and zero unauthorized provider writes with real database constraints and doubles. |
| VI. Increments | Shared foundation then story checkpoints; relevant migration/transaction/accessibility gates before exposure. |
| VII. Explicit state | Partial drafts separate from snapshots; preserve proposal/commit/undo; linking changes access, not versions. |
| VIII. Transactions | Registered account plus principal relation precedes booking; retain exact terms, expiry, immutable basis and provider-write serialization. |

Post-design compatibility review confirms unchanged owner keys/fingerprints/history, preserved account booking keys, revoked pre-link run grants and retained legal holds. Implementation must prove these invariants.

## Project Structure

### Documentation (this feature)

```text
specs/002-platform-guest-planning/
  spec.md
  codebase-context.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  contracts/{README,planning-api,ui-contract}.md
  checklists/requirements.md
  tasks.md                 # subsequent speckit-tasks output
```

### Source Code (repository root)

```text
web/
  components.json          # new Radix shadcn config
  postcss.config.mjs        # new Tailwind v4 pipeline
  lib/utils.ts             # class helper
  app/
    globals.css
    page.tsx
    (auth)/{sign-in,sign-up}/page.tsx
    auth/continue/page.tsx
    trips/new/page.tsx
    trips/[tripId]/{page.tsx,booking/page.tsx}
    api/v1/
      planning-session/route.ts
      setup-drafts/route.ts
      setup-drafts/[draftId]/{route.ts,submit/route.ts}
      booking-intents/route.ts
      booking-intents/[intentId]/link/route.ts
      places/route.ts
      trips/...
      agent-runs/...
  components/
    ui/
    marketing/
    auth/
    trip-setup/
    map/destination-globe.tsx
    trip-workspace/
    booking/
  server/
    auth/{auth,authorize,planning-session,planning-actor,booking-intent,link-trip}.ts
    db/{types,planning-principal-repository,setup-draft-repository}.ts
    db/migrations/011_planning_ownership.sql
    db/migrations/012_guest_drafts_and_linking.sql
    api.ts
    agent-client/{run-repository,credentials,client}.ts
    metrics/guest-planning.ts
    privacy/{retention,export-delete}.ts
    workflows/{book-activities,revalidate-activities}.ts
  domain/
    trip/{create,commit,read,...}.ts
    booking/{revalidate,authorize,start,reschedule,apply-outcomes,...}.ts
  tests/{unit,integration,contract,e2e}/
agent/                     # retain orchestration/wire shapes
contracts/                 # retain authoritative schemas
infra/                     # existing infrastructure
```

**Structure Decision**: Extend existing web/domain/repository patterns. New paths above are proposed. Keep agent wire userId as stable planning identity and booking userId/execution-basis owner as real account identity; enforce through typed server arguments/joins without rewriting immutable JSON or changing agent schemas.

## Phase 0: Research Outcomes

[research.md](research.md) resolves ownership, partial storage, auth continuation, run revocation, globe interaction, shadcn integration, Motion and verification. Skill-directed agents inspected ownership/booking and UI/map independently; root consolidated decisions. No unresolved clarification remains.

## Phase 1: Design and Contracts

### Storage and planning authority

Backfill default account principals with exact existing IDs; allocate one dedicated non-default principal per persisted wizard draft/resulting trip, with guest-session authority or immediate account binding as appropriate. A guest session can control several unlinked principals, and an account several linked principals. Repoint trip/conversation/legal-hold owner FKs to principals while retaining owner values, run composite keys, versions and fingerprints. Keep auth/booking FKs to accounts. Create session table before its principal FK. Deploy compatible web/worker changes and migrations together before enabling guest traffic; rollback disables guest entry without deleting records.

Planning access resolves principal through requested resource and proves its current account or valid guest-session binding, never a browser-supplied owner. Account direct creation retains a default principal; guest creation uses persisted drafts so owner/request IDs survive retries. Owner checks apply to reads, events and receipt replay.

Bootstrap by same-origin client POST; Server Components only read cookies. Use 256-bit opaque HttpOnly host-only cookie, Secure in production, SameSite=Lax, stored SHA-256 digest and rolling 30-day idle expiry. Keep guest proof through sign-in for explicit linking. Expiry cannot revive authority or delete accepted history.

Partial drafts have separate revision/current-step and bounded incomplete-input schema. Fully validate at submission. Persist immutable creation/research request IDs. Submission locks draft and creates/attaches one trip atomically through existing commit. Research follows with saved request ID; failure after creation retries the same trip. Save conflicts preserve local unsaved edits and cannot silently overwrite another tab.

### Linking and research revocation

Create selected-trip review_booking intent at boundary. After Better Auth success, explicit POST proves account and original guest authority; atomically bind principal to account, clear guest authority, invalidate stale draft revision, consume intent and record link/audit receipt. Linking creates no version or proposal acceptance. Same-account replay resolves original outcome; another account is denied without content. Completed link receipts remain recoverable by their account after cookie expiry.

Mark all pre-link runs planning_access_revoked_at; queued/running/awaiting-clarification runs become interrupted/retryable. Preserve completed results and pending proposals with unchanged expiry. Every internal planning read/write verifies live run grant plus signed audience/scopes/principal/trip/request/version under mutation locks. New research uses fresh request/run, so old credentials cannot access or mutate a linked trip; account browser history retains receipts.

Standardize overlapping lock order: guest-session/quota guard when applicable, principal, setup draft if present, trip, run, then existing mutation/idempotency/booking rows. Renewal, guest quota reservation, submission, linking, editing, acceptance and callbacks use this order. Count session-wide runs without locking scanned principal/run rows out of order; reserve quota and run atomically under the session guard. Initial non-disclosing lookup finds references only; recheck authority before commit/private replay. Streams recheck before delivery and terminate safely on linking.

### Registered booking identity

Booking record owners, authorization userId and immutable execution-basis owner remain registered account IDs. BookingActor carries accountUserId and planningOwnerId proven from session/principal relation. Trip reads/locks use principal; booking records/fingerprints use account. Update revalidate/authorize/start/reschedule/component operations, outcome commits and worker comparisons; preserve existing terms hashing, expiry/version evidence, material-change invalidation, active-write exclusion, outbox and duplicate prevention.

Workers independently prove execution account's principal relation then commit status/evidence with principal. Session expiry blocks new browser actions; already explicitly authorized durable transactions follow existing terms/expiry and do not cancel merely due to logout. Linking never creates booking records or starts provider workflows.

### UI integration and increments

One persisted draft controller owns destination, origin, dates/duration, travellers, preferences/requirements and review steps. Reuse domain/field logic and existing estimate/workspace routes. Copy only needed Radix shadcn components; bridge existing variables into semantic utilities without replacing legacy accent, typography, focus or forced colors. Scope legacy form selectors and add missing Tailwind PostCSS configuration.

Use existing MapLibre globe projection, local countries/worker, canonical country lookup and country-filtered city candidates/points. Coordinates do not supply invented destination identities. Maintain equivalent search/list actions and schematic-route disclaimers; focus new headings/errors and retain responsive summaries.

[data-model.md](data-model.md) defines constraints/transitions; [contracts](contracts/README.md) define API/access/UI behavior; [quickstart.md](quickstart.md) defines executable validation. Shared foundation supports US1 guest setup, US2 private refinement, US3 account linking/booking identity, US4 marketing and US5 cohesive responsive polish. Accessibility and transaction protection are required in every increment. Keep guest booking gated until US3 integration passes, and navigation truthful to enabled routes.

## Complexity Tracking

No constitutional exceptions. Stable principals preserve existing immutable/composite owner and receipt identities; rewriting owners or creating fake accounts would undermine those boundaries. No extra service, framework or initial animation engine is justified.
