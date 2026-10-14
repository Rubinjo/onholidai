# Codebase Context: Platform UX, Guest Planning & Account Creation

Inspected on 2026-10-14 before writing `spec.md`. These are current-state findings and planning constraints, not implemented changes.

## Existing product and routes

- `web/app/page.tsx` is a minimal homepage with a planning link and a stale-looking "Booking is not available yet" statement. Booking routes and controls exist elsewhere; marketing must be reconciled with enabled capabilities.
- `web/app/trips/new/page.tsx` redirects signed-out visitors to `/sign-in`. `web/components/trip-setup/setup-form.tsx` uses one form and page-local state, saves a valid trip, starts research, and navigates to `/trips/{tripId}?runId=...`.
- `web/app/trips/[tripId]/page.tsx` requires an account session and renders estimate review or the workspace. Preserve this route as the continuation after setup rather than moving all refinement into `/trips/new`.
- `web/app/trips/[tripId]/booking/page.tsx` requires a session and checks finalized/partially-booked/booked state. `price-bar.tsx` enables booking review for eligible lifecycle states.
- `/sign-in` uses server actions and a same-origin validated `redirectTo`. It currently says sign-in is needed for planning. No sign-up page is present.

## Authentication and access

- `web/server/auth/auth.ts` configures Better Auth with email/password, Postgres-backed identity/session tables, UUID identifiers, locale/currency fields, trusted origins, and Next cookie integration. No anonymous plugin is configured.
- `web/server/api.ts` requires an account through `browserUser`, rejects mutating requests from other origins, bounds request bodies, and marks responses private/no-store. Guest support must distinguish a planning owner from a registered booking customer, rather than remove authorization globally.
- `web/domain/trip/read.ts` joins trip/version records and filters `ownerUserId`. Proposals, conversations, and research repositories also enforce owner scope. Internal service credentials bind owner, trip, request, version, audience, and scope; private diagnostic pricing remains privileged.

## Persistence and linking implications

- `web/server/db/database.ts` uses Kysely, PostgreSQL/PostGIS, and the `app` schema. `002_trip_core.sql` requires each trip's `owner_user_id` to reference an account row; there is no guest owner or incomplete setup record currently.
- `create.ts`, `commit.ts`, `trip-repository.ts`, and `transaction.ts` implement structured validation, locked/conditional version advancement, request fingerprints and idempotency, audit evidence, and durable outbox events. Creation requires a complete snapshot; invalid partial setup cannot simply be stored as a valid trip version.
- `004_agent_runs.sql` binds research runs to conversations through a composite identity including owner. Proposals reference run/trip/request/version evidence and have immutable identity guards. Linking cannot safely be implemented as only changing the trip owner column.
- `run-repository.ts` checks both trip and run ownership and validates service-token context. Planning must define atomic related-record ownership handling and how active research is completed, rebound, or safely interrupted. Old credentials must not acquire new authority through linking.
- `web/server/privacy/retention.ts` expires raw conversation content after 90 days and requires review of trip records after 24 months of inactivity. Accepted history and transaction evidence are not automatically deleted merely because access expires.
- The specification defines observable ownership and persistence guarantees. The schema/migration strategy belongs in planning and must preserve existing foreign keys, immutable history, receipts, and account-owned records.

## Existing setup and domain behavior

- `destinations.tsx` searches `/api/v1/places`, explicitly confirms origin, adds country/city/place identities, prevents exact repeated place selection, and offers earlier/later/remove controls. Replacement is a required new setup interaction; preserve the eight-destination bound.
- `availability.tsx` exposes multiple preferred/flexible windows, timezones, and minimum/ideal/maximum days; `party-preferences.tsx` covers up to ten travellers, child ages, and five preference values. `constraints.tsx` stores reviewable free text, category, priority, provenance, and unverified status.
- `estimate-summary.tsx` polls durable research, handles clarification and retry, and requires explicit proposal acceptance. Existing workspace editing, proposal impact review, history, and undo all operate on the same authoritative trip.
- `specs/001-ai-trip-agent/spec.md` and `.specify/memory/constitution.md` require confirmed origin, explicit estimate acceptance, reversible draft versions, feasibility checks, privacy and accessible alternatives. Booking retains live revalidation, exact-term authorization, invalidation on material changes, duplicate prevention, durable outcomes, and partial-failure handling.

## Mapping and UI

- `estimate-map.tsx` dynamically imports MapLibre, uses the vendored `/maplibre/maplibre-gl-worker.mjs`, draws local Natural Earth country GeoJSON, highlights selected countries, adds numbered destination markers, and draws schematic route lines and supplied travel geometries. It starts hidden behind an optional-map button; the canvas is hidden from assistive technology.
- `destination-picker.tsx` wraps that display map. The inspected implementation has no globe projection configuration or country/city selection event handling. Reuse its assets, identity conventions, attribution, and fallbacks while planning the new globe interaction.
- `itinerary-map.tsx` projects the accepted itinerary into the existing geographic view. Schematic lines must not become purported verified travel routes.
- `web/package.json` includes Radix UI, Tailwind, React Day Picker, and MapLibre; no dedicated motion package is listed. `components/ui` contains `accessible-field.tsx` and `status-announcer.tsx`, not a full shadcn component catalog.
- `globals.css` defines theme colors, serif typography, focus and forced-color support, touch targets, reduced-motion overrides, setup/map styles, and responsive workspace panes. Preserve the accessibility conventions and establish coherent component reuse before adding dependencies.

## Existing verification seams

- Domain/unit and integration coverage includes setup values, trip commit/version propagation, research and proposal handling, migration compatibility, retention, workspace propagation, and booking authorization/privacy/workflows.
- Existing browser tests cover estimate and outage behavior, setup/accessibility, refinement, finalization, and booking. Extend behavior coverage for guest ownership, draft restoration, authentication continuation, linking races, and zero consequential side effects; do not substitute new UX tests for existing safety checks.

## Spec Kit inspection

- No `AGENTS.md` was found in the repository inventory, and `.specify/extensions.yml` is absent.
- Numbering is sequential in `.specify/init-options.json`; `001-ai-trip-agent` was the only existing feature directory.
- The template resolution script resolved the core specification template. Its section order is preserved in the new specification; architecture evidence is kept here to distinguish current implementation from user-facing requirements.
