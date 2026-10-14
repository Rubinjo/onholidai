# User Story 3 implementation evidence

Date: 2026-10-14. Scope: T070–T080 and convergence T139–T142. The implementation skill's checklist gate passed (requirements.md: 16 checked, zero unchecked). No `.specify/extensions.yml` exists, so no pre/post hooks are registered.

## Implemented behavior

- Explicit finalization research produces a dated itinerary proposal from the accepted destination route and component times. It is persisted through the existing scoped event/result receipts, reviewed with price/schedule impacts and accepted as a new draft version. Research does not mutate the trip. Missing destination timezones require clarification; newly selected places retain their resolved timezone.
- Day cards expose morning/afternoon/evening plans, meals, free time, practical notes, travel modes, timezone-qualified segment times, directions and source/freshness. Component cards expose flight/stay/activity/rail/transfer facts, prices, cancellation and booking requirements. Unknown facts remain visibly unavailable. Read adapters can carry sourced service times and structured planning details; directions use an injected read-only reader.
- Feasibility policy v1 checks elapsed instants/DST, duration/window/route coverage, overlap, sourced upper duration plus 15-minute transition, station/airport/provider arrival buffers, published connection minimum plus 30 minutes, overnight rest, meals/free time, pace/occupied caps, required schedule/constraint evidence, availability/eligibility and hotel-change limits. Known failures block finalization; unknown facts cannot score verified. Mandatory long-distance travel exceptions do not waive impossible connections or required constraints. Lower-priority moves are suggestions, not automatic edits. Conversation can propose `Remove activity <id>` or `Move activity <id> to YYYY-MM-DD at HH:MM` for a non-supplier item; component-linked activities require fresh supplier review.
- Finalization review is version-bound and distinguishes blocking issues, unverified conditions and exceptions. Explicit acceptance of the current report is required. Finalization rechecks complete snapshot references and integer price sums, commits a version/lifecycle/outbox/audit atomically and replays the original receipt for identical authorized retries. Undo returns the planning trip to a draft as another version. Booking stays disabled.
- Optional additive v1 snapshot fields preserve historical reads. Snapshot/itinerary JSON contracts and source/promoted public OpenAPI are synchronized; Node-based generator drift verification remains deferred.

## Validation actually performed

- `agent/.venv/Scripts/python.exe -m pytest agent/tests -q`: **63 passed** after installing pinned `tzdata==2025.2`, including proposal preservation, missing-timezone clarification, reviewed activity moves/removals with supplier protection, frozen corpus integrity, and all existing agent regressions.
- Targeted Ruff check/format for the changed Python generation/dispatch/read code, enrichment and itinerary tests: passed. Existing unrelated Python type-check errors are not claimed resolved.
- `git diff --check`: passed. Repository ignore configuration already covers detected Node/Python/Docker build outputs, caches, secrets and test artifacts; no publishing ignores are required for the private workspace.
- Python lock resolution was attempted offline but could not resolve the pre-existing FastAPI pin from local cache. The new tzdata entry was added using the exact PyPI 2025.2 wheel/sdist URLs, sizes and SHA-256 digests; unrelated locked versions were retained. A later locked install/drift check is required.

## Frozen evaluation revision

Corpus 1.3.0, policy 1; seed `onholidai-evaluation-v1-seed-20261011`; hash `sha256:797b8a4f4d20a32b5c5863a5e2b093f12bde056a99b2ac7828b51327839fb176`.

Both corpus copies replace arbitrary itinerary labels and hard-conflict strings with executable timezone-qualified snapshot inputs. Twenty of the 500 items have a concrete duration-upper-bound violation; expected scoring is 480/500. The 20 hard cases contain actual impossible connections, failed required accessibility, ineligibility, date-window violations or conflicting required constraints. These are expected outcomes, **not measured web-policy results**. Estimate/refinement cases, seed and denominators are preserved. The recorded revision reason requires a fresh complete evaluation. T128 remains open until the complete corpus evaluates successfully.

## Deferred validation and commands

The user explicitly requested skipping checks requiring Node.js, pnpm or Docker in this environment. Web tests, TypeScript/lint/build, PostgreSQL-backed finalization tests, contract/corpus generator drift checks and browser runs were therefore not executed. No 475/500 web-policy result, successful browser journey, live-provider performance, manual screen-reader result or participant rating is claimed.

Run in the intended environment from the repository root (with an isolated test database for integration tests):

```powershell
pnpm lint
pnpm typecheck
pnpm --dir web build
pnpm --dir web snapshot:contract:check
pnpm --dir web corpus:check
pnpm test:contracts
pnpm --dir web test -- tests/integration/finalization.test.ts
pnpm test
uv sync --project agent --frozen
uv run --project agent pytest
```

For browser tests, create a fresh synthetic fixture using `node scripts/seed-us2-fixture.mjs`; use its `US1_STORAGE_STATE` and set `US3_TRIP_ID` to its printed `US2_TRIP_ID`. Start the migrated deterministic web/agent stack and run `pnpm --dir web test:e2e -- --grep @us3`. Previously seeded destinations without a timezone require explicit clarification such as `Tokyo: Asia/Tokyo`.

Deterministic supplier doubles now use separate outbound/return flights and finite activity/rail intervals rather than whole-query transport/activity spans; the combined synthetic flight cost is preserved. These are explicitly fictional schedules and unknown supplier/location facts remain unverified. Previously accepted fixtures retain their original immutable placeholder intervals: finalization deliberately discloses/blocks conflicts from those inputs. Reseed for the revised synthetic schedules, and use genuinely sourced component times for live-provider acceptance.

T081 remains unchecked: run US3 suites, confirm at least 475/500 scored items and all 20 hard conflicts, complete keyboard/screen-reader review including map failure, and collect actual fixed-cohort ratings (at least 18/20 scoring pace and destination mix ≥4/5). None of those manual/participant outcomes are inferred from Python tests.
