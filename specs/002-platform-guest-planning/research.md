# Research: Platform UX, Guest Planning & Account Creation

Completed 2026-10-14 from repository inspection and primary documentation. No runtime changes. All design unknowns resolved.

## Stable planning identity

**Decision**: Add stable principals; account defaults preserve existing IDs, each guest draft/resulting trip has one principal. Link only selected principal.
**Rationale**: Migration 002 requires account owner FKs; 004 binds conversation/trip/owner and owner/request uniqueness; 005 protects run fingerprints; commit.ts binds receipts to owner. Changing authority separately retains evidence.
**Alternatives considered**: Fake/anonymous account rows confuse registration, rewriting owners breaks bindings, and parallel guest storage duplicates authoritative state.

## Sessions, drafts and limits

**Decision**: Database-backed opaque cookies, 30-day idle expiry, revisioned partial drafts and immutable creation/research IDs. Two active runs and ten new runs/hour/session; replay free. New-session bootstrap capped at twenty/hour per secret-hashed network key, one-hour bucket retention and no raw-address logging.
**Rationale**: Current page-local setup is lost on refresh; create-trip requires complete state. PostgreSQL transactions preserve partial state/concurrency and enforce cross-replica limits without Redis.
**Alternatives considered**: Browser-only accepted state is not durable; invalid snapshots bypass domain rules; local-memory limits fail across replicas; registration quotas violate guest planning. Limits are configurable and offer retry guidance.

## Booking and privacy

**Decision**: Preserve account FKs/ownership in booking tables and immutable execution bases; server arguments carry planning principal and account separately. Repoint only planning/legal-hold owner FKs.
**Rationale**: authorize.ts/start.ts/apply-outcomes.ts and worker activities currently equate owner/account; explicit joins resolve linked guest principals. booking/invalidate.ts is already trip/transaction scoped. Export/delete needs the same principal boundary; legal holds and existing retention remain.
**Alternatives considered**: Booking-owner conversion obscures the authorizing account; route-only gating misses domain/worker assumptions.

## Research on linking

**Decision**: Revoke every old run grant via planning_access_revoked_at, interrupt active guest runs, retain completed/proposed evidence and original expiry; new retry uses fresh request/run. Internal planning routes verify live grant transactionally as well as signed context.
**Rationale**: Stable identity alone leaves old signed credentials valid contrary to FR-021. Request-level revocation avoids JWT/schema migration and timestamp ambiguity while preserving browser receipts.
**Alternatives considered**: Letting callbacks continue violates old-credential requirements; authority epochs in all wire schemas expand scope; resetting scopes/expiry broadens authority.

## Authentication and continuation

**Decision**: Reuse Better Auth email/password server methods and Next cookie integration; add name/email/password sign-up with existing policy/defaults. Durable selected-trip intent and POST continuation prove account plus original guest session.
**Rationale**: Both server auth methods already exist in the library; sign-up UI is missing. Fixed intent protects scope and replay without treating redirect as consent. [Better Auth email/password](https://better-auth.com/docs/authentication/email-password).
**Alternatives considered**: Replacement auth/social login/email delivery are outside scope; auto-linking all session trips violates selected-trip-only policy.

## Globe

**Decision**: Existing MapLibre globe projection, local countries/worker/attribution, canonical country lookup and country-filtered resolved city points. Keep one map instance with source/filter updates and complete keyboard search/list fallback.
**Rationale**: Existing map is display-only; country geometry has no city catalog. MapLibre supports projection/feature querying, so no new engine is needed; coordinates cannot determine authoritative identity/timezone. [Globe example](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-globe-with-a-vector-map/), [feature queries](https://maplibre.org/maplibre-gl-js/docs/examples/get-features-under-the-mouse-pointer/).
**Alternatives considered**: Three.js/provider replacement unnecessary; comprehensive city dataset or arbitrary-click reverse geocoding adds scope.

## shadcn and tokens

**Decision**: Radix shadcn source in existing components/ui, current aliases/field/status/calendar controls, only required class helpers and matching Tailwind PostCSS setup. Alias semantic tokens to existing CSS; preserve legacy accent and separate subdued hover surface.
**Rationale**: Radix/Tailwind exist but full shadcn and PostCSS configuration do not. Source components fit current conventions. [Manual install](https://ui.shadcn.com/docs/installation/manual), [Radix Button](https://ui.shadcn.com/docs/components/radix/button), [Radix Dialog](https://ui.shadcn.com/docs/components/radix/dialog), [theming](https://ui.shadcn.com/docs/theming), [Tailwind Next.js setup](https://tailwindcss.com/docs/installation/framework-guides/nextjs).
**Alternatives considered**: Default initializer may replace primitives/theme. Do not add form, toast, icon, cmdk or calendar packages solely for redesign; remove unused copied imports.

## Motion

**Decision**: Existing CSS initially; defer motion unless changing-list layout improves clarity. If adopted, scoped motion/react, MotionConfig reducedMotion='user' and independent map-camera motion checks.
**Rationale**: Simple fades/entrance need no package. Motion supports list layout, but navigation must not wait for exits and reduced motion must be configured. [Layout](https://motion.dev/docs/react-layout-animations), [MotionConfig](https://motion.dev/docs/react-motion-config), [reduced-motion hook](https://motion.dev/docs/react-use-reduced-motion).
**Alternatives considered**: Motion for fades adds cost; auto-rotation unnecessary; DOM transforms should not animate map geometry.

## Verification

**Decision**: Existing Vitest/Playwright, isolated PostgreSQL/agent/provider doubles; freeze task briefs and regression cases before implementation.
**Rationale**: Real locks/FKs, migration invariants, zero provider side effects and accessible journeys require behavioral evidence. Report skips/participant denominators and deterministic versus live timing.
**Alternatives considered**: Mock-only linking cannot prove constraints; screenshots alone do not establish accessibility; new harness dilutes existing coverage.
