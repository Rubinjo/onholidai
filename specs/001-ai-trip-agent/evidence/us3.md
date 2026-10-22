# User Story 3 implementation evidence

Date: 2026-10-14. Scope: T070–T080 and convergence T139–T142. The implementation skill's checklist gate passed (requirements.md: 16 checked, zero unchecked). No `.specify/extensions.yml` exists, so no pre/post hooks are registered.

## Implemented behavior

- Explicit finalization research produces a dated itinerary proposal from the accepted destination route and component times. It is persisted through the existing scoped event/result receipts, reviewed with price/schedule impacts and accepted as a new draft version. Research does not mutate the trip. Missing destination timezones require clarification; newly selected places retain their resolved timezone.
- Day cards expose morning/afternoon/evening plans, meals, free time, practical notes, travel modes, timezone-qualified segment times, directions and source/freshness. Component cards expose flight/stay/activity/rail/transfer facts, prices, cancellation and booking requirements. Unknown facts remain visibly unavailable. Read adapters can carry sourced service times and structured planning details; directions use an injected read-only reader.
- Feasibility policy v1 checks elapsed instants/DST, duration/window/route coverage, overlap, sourced upper duration plus 15-minute transition, station/airport/provider arrival buffers, published connection minimum plus 30 minutes, overnight rest, meals/free time, pace/occupied caps, required schedule/constraint evidence, availability/eligibility and hotel-change limits. Known failures block finalization; unknown facts cannot score verified. Mandatory long-distance travel exceptions do not waive impossible connections or required constraints. Lower-priority moves are suggestions, not automatic edits. Conversation can propose `Remove activity <id>` or `Move activity <id> to YYYY-MM-DD at HH:MM` for a non-supplier item; component-linked activities require fresh supplier review.
- Finalization review is version-bound and distinguishes blocking issues, unverified conditions and exceptions. Explicit acceptance of the current report is required. Finalization rechecks complete snapshot references and integer price sums, commits a version/lifecycle/outbox/audit atomically and replays the original receipt for identical authorized retries. Undo returns the planning trip to a draft as another version. Booking stays disabled.
- Optional additive v1 snapshot fields preserve historical reads. Snapshot/itinerary JSON contracts and source/promoted public OpenAPI are synchronized; Node-based generator drift verification remains deferred.

## Validation actually performed

- `agent/.venv/Scripts/python.exe -m pytest agent/tests -q`: **63 passed** (Windows requires `--basetemp` because the ambient pytest temp directory is not writable in this profile).
- `pnpm --dir web lint`: passed. `pnpm --dir web typecheck`: passed.
- `pnpm --dir web test` against isolated PostgreSQL 18/PostGIS databases: **40 files, 214 tests passed**, including the US3 contract, integration and browser-gated specs, the frozen corpus evaluation and the booking suites.
- `pnpm --dir web test -- tests/evaluation/evaluation-corpus.test.ts`: scores the frozen 100-day/500-item corpus against the real feasibility policy and records **480/500 items passing with exact agreement to the frozen per-item labels**, and all 20 hard-conflict cases reported as blocking with their frozen expected code.
- `pnpm --dir web snapshot:contract:check` and `pnpm --dir web corpus:check`: passed after the generated `snapshot-v1`/`itinerary-v1` contracts were regenerated (semantically identical to the committed schemas, key order only) and the check comparison was made line-ending tolerant for Windows checkouts.
- Python lock resolution was attempted offline but could not resolve the pre-existing FastAPI pin from local cache. `uv sync --project agent --frozen` installed the pinned `tzdata==2025.2` from the lock; `Europe/Lisbon`-dependent finalization then resolved correctly.
- `git diff --check`: passed. Repository ignore configuration already covers detected Node/Python/Docker build outputs, caches, secrets and test artifacts; no publishing ignores are required for the private workspace.

### Repairs required to run the US3 suites

- Operation values parsed by `proposalOperationSchema` used `z.json()`, which rejects own keys whose value is `undefined`.
  Parsed component objects carry `planningDetails: undefined`, so refinement repricing and frozen-refinement validation
  failed. The value schema now tolerates undefined-valued keys, which JSON serialization drops.
- `tests/integration/finalization.test.ts` asserted that exactly nine hours of overnight rest is a violation; policy v1
  requires "at least 9 hours", so the test now verifies the boundary is preserved and constructs a genuine 8-hour violation.
- `web/domain/trip/schema.ts` imported `./itinerary` without an extension, which `node --experimental-strip-types`
  cannot resolve, so the snapshot-contract generator could not run at all.

## Frozen evaluation revision

Corpus 1.3.0, policy 1; seed `onholidai-evaluation-v1-seed-20261011`; hash `sha256:797b8a4f4d20a32b5c5863a5e2b093f12bde056a99b2ac7828b51327839fb176`.

Both corpus copies replace arbitrary itinerary labels and hard-conflict strings with executable timezone-qualified snapshot inputs. Twenty of the 500 items carry a concrete duration-upper-bound violation. The 20 hard cases contain actual impossible connections, failed required accessibility, ineligibility, date-window violations or conflicting required constraints. Estimate/refinement cases, seed and denominators are preserved.

Measured with `tests/evaluation/evaluation-corpus.test.ts` (SC-007 gate):

- **480/500 items pass** the feasibility policy, exactly matching the frozen per-item labels (threshold 475/500).
- **20/20 hard-conflict cases are blocked and disclosed** with their frozen expected code (`impossible_connection`,
  `required_constraint`, `component_unavailable`, `date_duration`, `constraint_conflict`). `finalizeTrip` refuses to
  commit while any blocking issue exists, so every case leaves the trip a draft.
- The four `date_window_violation` inputs are rejected by the authoritative v1 snapshot contract (availability window
  start after end) that finalization itself applies, so they can never be persisted and never reach policy review. The
  policy still reports `date_duration` when such state is evaluated defensively. Recording a _schema-valid_ date/duration
  hard conflict needs a corpus revision and stays with T128.

## Deferred validation and commands

Executed in this environment: lint, typecheck, the full web suite with isolated PostgreSQL databases, the corpus and
snapshot drift checks, the contract suites and the agent suite (see results above). Still outstanding and not claimed:

- `pnpm --dir web build` was not run.
- Browser journeys (`@us3`, `@us4`) remain gated on a seeded authenticated fixture and were skipped; no browser,
  screen-reader or zoom result is claimed.
- No participant cohort was run, so the SC-007 pace/destination-mix ratings and every SC-012 manual outcome remain open
  (T081, T107, T112, T114).

Run from the repository root (with isolated test-database credentials set):

```powershell
pnpm lint
pnpm typecheck
pnpm --dir web build
pnpm --dir web snapshot:contract:check
pnpm --dir web corpus:check
pnpm test:contracts
pnpm --dir web test
pnpm --dir web exec vitest run tests/evaluation/evaluation-corpus.test.ts
uv run --project agent pytest
```

For browser tests, create a fresh synthetic fixture using `node scripts/seed-us2-fixture.mjs`; use its `US1_STORAGE_STATE` and set `US3_TRIP_ID` to its printed `US2_TRIP_ID`. Start the migrated deterministic web/agent stack and run `pnpm --dir web test:e2e -- --grep @us3`. Previously seeded destinations without a timezone require explicit clarification such as `Tokyo: Asia/Tokyo`.

Deterministic supplier doubles now use separate outbound/return flights and finite activity/rail intervals rather than whole-query transport/activity spans; the combined synthetic flight cost is preserved. These are explicitly fictional schedules and unknown supplier/location facts remain unverified. Previously accepted fixtures retain their original immutable placeholder intervals: finalization deliberately discloses/blocks conflicts from those inputs. Reseed for the revised synthetic schedules, and use genuinely sourced component times for live-provider acceptance.

T081 remains unchecked: the US3 suites and the frozen corpus now pass as recorded above, but the manual keyboard/screen-reader review including map failure and the actual fixed-cohort pace/destination-mix ratings (at least 18/20 scoring ≥4/5) have still not been collected. None of those manual or participant outcomes are inferred from automated tests.

## Corpus revision 1.4.0 (2026-10-14, T128)

The four `date_window_violation` hard-conflict inputs were schema-invalid (an availability end date before its start date), so `tripSnapshotSchema` rejected them before policy review. They are now storable snapshots where a single planned day is fewer than the accepted minimum duration inside a window that could hold it; the feasibility policy reports `date_duration`, not the schema. Corpus identity: 1.4.0, policy 1, seed `onholidai-evaluation-v1-seed-20261011`, hash `sha256:a3b080fa74e88215d03c495e634bea163f4d77af30d47f2483b89bec26119cea`. `tests/evaluation/evaluation-corpus.test.ts` now asserts that every hard-conflict case is storable and that 20/20 are blocked and disclosed with their frozen expected code; the 100-day/500-item scoring is unchanged.
