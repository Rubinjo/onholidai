# Supplier MCP and booking baseline

Date: 2026-10-18. Feature: `003-supplier-mcp-booking`.

Latest bounded discovery implementation and verification:
[four-step discovery evidence](discovery.md). Earlier entries below remain
historical; they do not override the current implementation/access ledger.

## Scope and preserved work

- Initial worktree: untracked `.github/skills/`; preserved without modification.
- User authorized skipping manual checks for this execution. Manual accessibility,
  usability and external provider acceptance remain unverified, not passing.
- No live provider requests, reservations, transactions or migrations were run.
- Migration tip: `013_automatic_planning.sql`. Future migrations must be additive.
- Existing Git/Docker ignore files cover Node/Python outputs and secrets; ESLint
  flat configuration excludes generated/build/test outputs. Packages are private.

## Reproducible commands and results

Commands run from the repository root in Git Bash on Windows:

| Command | Result |
| --- | --- |
| `SPECIFY_FEATURE_DIRECTORY=/c/Users/506916/Git/onholidai/specs/003-supplier-mcp-booking SPECIFY_FEATURE_NO_PERSIST=1 .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` | Resolved feature 003 and all supporting documents. No persisted feature selection changed. |
| `node.exe --version` | Node 24.21.0. |
| `corepack.cmd pnpm --version` | pnpm 12.11.2, matching the root package manager. |
| `uv --version` | uv 0.9.18. |
| `uv run --project agent --no-sync python --version` | Python 3.13.11. |
| `corepack.cmd pnpm --dir web test` | 62 test files passed, 12 skipped; 260 tests passed, 83 skipped. Lockfile policy check and installation of locked workspace dependencies preceded the run. Nonfatal jsdom canvas warning. |
| `uv run --project agent --no-sync pytest agent/tests -q` | 87 passed, 1 failed. Existing `test_itinerary_is_a_reviewable_proposal_and_preserves_authoritative_choices` expects a proposal but receives clarification. No dependency synchronization was performed. |
| `docker info --format '{{.ServerVersion}}'` | Failed: Docker Desktop Linux engine named pipe unavailable. No infrastructure started. |

These are baseline results, not feature acceptance. Skipped tests are not passes.
Lint, type, contract, migration, Temporal and browser gates have not yet been run
in this execution.

## T002 dependency validation

Pinned standalone `fastmcp==4.1.1` without extras. PyPI release metadata declares
Python >=3.10; the frozen installation ran under Python 3.13.11.
`uv lock --project agent` resolved 110 packages, followed by
`uv sync --project agent --frozen`. A real `FastMCP`/`Client(server)` in-memory
list/call smoke check returned its expected string. A structured comparison with
the pre-change UV lock confirmed every existing locked package version remained
unchanged. Optional FastMCP task/cloud and Anthropic/Gemini/Azure integration
packages checked by the smoke command were absent. No server process was started.

## T004 shared schema validation

Extracted reusable component base, service and price field definitions without
relaxing accepted-component refinements or changing the legacy snapshot decoder.
Planning offer attribution reuses the canonical provider field. Zod's existing
integer validator already rejects unsafe minor units; no redundant numeric policy
was added. New behavioral tests cover safe bounds, ISO currencies, strict accepted
service dates, currency consistency and price arithmetic. These refactor-preserving
tests passed before extraction; no pre-existing money defect is claimed.

- Focused unit/contract run: 12 passed across trip schema and supply read tests.
- Snapshot v1 contract drift check: passed with no generated changes.
- Web TypeScript: passed.
- ESLint on changed TypeScript files: passed.

## T005 privacy validation

New canaries first reproduced three web failures (nested component economics and
encoded URLs, typed problem text, allowlisted telemetry tokens) and one Python
redaction failure. Fixes use explicit public component/root field selection,
bounded decoded supplier-text filtering, safe typed-error fallback and existing
telemetry boundaries. Nested planning facts and propagation metadata are covered;
customer/agent projections preserve harmless facts and do not mutate authoritative
snapshots. Booking authorization codes remain actionable rather than being
mistaken for credential material.

- Final full web suite: 265 passed, 83 skipped; 62 files passed, 12 skipped.
- Web lint and TypeScript: passed.
- Final frozen agent suite: 89 passed; Ruff and strict Pyright passed.
- The initial itinerary baseline failure no longer reproduced after frozen
  dependency installation. Its cause was not established; no itinerary code was
  changed and no claim of fixing that behavior is made.
- Database/Temporal/browser and manual/provider-access gates remain unverified.

## T006 canonical supply contracts

Added a strict public offer projection reusing canonical component variants and
the existing safe component projection. The targeted contract test first failed
for the missing projection, then passed after implementation. Public pricing
rejects private price objects and extra root fields. Zod owns generated
`contracts/supply/public-offers-v1.schema.json`; Pydantic owns generated
`contracts/supply/supplier-tools-v1.schema.json`. Existing agent tools are unchanged.
The four supplier argument models forbid model-settable trusted context and
coercion; handler authorization is still future work, not established by schemas.

- Both generators and their drift checks passed.
- Existing contract validator plus 15 shared supply/tool wire cases passed in
  Node/Zod and Python/Pydantic/JSON Schema.
- Web contracts: 75 passed, 12 database-dependent cases skipped.
- Web lint/TypeScript and Python Ruff/Pyright passed.
- MCP tool registration, extended uncertainty/readiness fields and live provider
  behavior remain tasks for the later story implementations.

## T007 deterministic provider/fault fixtures

Extended existing TypeScript/Python doubles with explicit search/detail/read-only
revalidation and no-matches/unsupported/rate-limit/deadline/error modes, injected
clocks, immutable evidence, write-attempt/write counters and restorable committed
provider state. Timeout-after-commit survives simulated process reconstruction;
replay returns the original truth without another write. Unavailable components
provide partial-failure fixtures. Booking seed expiry calculations accept an
injected time. All controls remain under test directories.

- New fixture tests failed before implementation in both languages.
- TypeScript provider fixture tests: 5 passed; web TypeScript passed.
- Python evaluation/fixture tests: 5 passed; Ruff and Pyright passed.
- Database-backed booking seeding is typechecked but not executed while Docker's
  Linux engine is unavailable; this is not database or workflow acceptance.

## T008 operation-level configuration and phase checkpoint

Replaced the generic travel-key startup gate with typed `SUPPLIER_PROVIDERS`
configuration containing separate read/transaction secret references and explicit
per-operation support/access declarations. Application startup exposes only safe
readiness summaries and filters injected live search providers to supported,
verified operations. Unknown or absent providers do not disable unrelated trip
reads. Recording a credential alone yields configured-unverified access, not
verification. Verification additionally requires a recorded evidence reference
and timestamp. Readiness declarations do not replace provider activation review.

Read secret presence is evaluated only for the web audience; transaction secret
presence only for the worker audience. Secret values/references are absent from
readiness output. Existing worker integration and actual tool dispatch remain
later story tasks. Deterministic mode remains the default.

`SUPPLIER_PROVIDERS` is JSON keyed by `booking`, `duffel`, `trainline` and/or
`getyourguide`. Entries contain `readSecretRef`, `transactionSecretRef` and an
`operations` map. Operations are `search`, `detail`, `revalidation`, `book`,
`status`, `idempotency`, `cancel` and `reschedule`. Each declaration contains
`support`, `access`, optional `evidenceRef` and optional `verifiedAt`. Omitted
facts are unknown/unconfigured. Populate only approved evidence, and provision
the referenced secret separately in its owning process. No real account evidence
or credentials were established by this execution.

- New startup/readiness tests failed before implementation, then passed.
- Configuration/application focused tests: 10 passed.
- Final full web suite: 270 passed, 83 skipped; web lint and TypeScript passed.
- Final full agent suite: 92 passed; Ruff and strict Pyright passed.
- Existing/shared contract validator: passed, including 15 supply wire cases.
- **Required foundation checkpoint failed before test collection**:
  `corepack.cmd pnpm --dir web test:foundation` requires
  `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_MIGRATION_URL`,
  `TEST_DATABASE_APP_URL` and `TEST_DATABASE_WORKER_URL`. None were available to
  the runner. Docker's Linux engine was also unavailable at baseline.

T001-T008 code tasks are complete; the foundation phase is **not validated**.
Implementation stopped before T009/story work, rather than treating skipped
database tests as acceptance. Manual checks alone were deferred by the user.
Resume the required foundation command after provisioning the isolated database
roles/URLs from `infra/postgres/test-roles.sql` and starting the local engine.

## Environment prerequisites and limitations

### T093 revised supplier configuration attempt (2026-10-19)

Preserved the pre-existing dirty worktree, including prior foundation changes
and unrelated trip editor/conversation work. The specification checklist is a
read-only quality gate: all 16 items were checked; no checklist markers changed.
Git/Docker ignores and ESLint flat-config exclusions already cover the detected
Node/Python stack; both packages are private, so no publishing ignore was added.

Implemented:

- Active configuration IDs `duffel`/`viator` with independent product/operation
  readiness for flights, accommodation and activities; rejected invalid
  provider/product combinations and old active supplier configuration entries.
  Legacy saved-data decoding/reconciliation was not changed.
- Separate Duffel read/write references and rejection of equal nonempty key
  values when both references resolve in the same process. Actual upstream
  permission verification is still an external requirement.
- Same Viator reference permitted in trusted web/worker configuration without
  inferring booking entitlement; safe readiness contains no secret values or
  references. No new supplier secret is sent to Python/browser.
- Live injected search adapters require verification for every advertised
  product. Existing provider-level Duffel operation evidence applies only to
  Flights, never Stays; explicit product declarations cannot inherit stale
  operation evidence. Deterministic mode never claims live verification.
- Worker entry explicitly requests worker-audience composition and creates no
  planning providers. The restricted transaction registry remains empty; actual
  supplier transports/allowlists/worker activation are later story tasks.
- Updated the operations guide and readiness ledger. Access to `.env.example`
  was denied; it was neither read nor modified in this pass. The guide includes
  the new schema and warns that the environment example remains outdated.

| Command / check | Result |
| --- | --- |
| Spec Kit prerequisite script with `--json --require-tasks --include-tasks` | Resolved feature 003 and design documents. No extension hooks configured. |
| Test tool on the two configuration/application unit files | No tests discovered; used the repository Vitest command instead. |
| `corepack.cmd pnpm --dir web test tests/unit/config.test.ts tests/unit/application.test.ts` before implementation | 15 failed, 6 passed; reproduced missing product readiness, missing Viator/shared-key support, aliased Duffel key acceptance and worker composition gaps. |
| Same focused Vitest command after implementation | 21 passed, 2 files passed, zero skipped. |
| `corepack.cmd pnpm --dir web typecheck` | Passed. |
| `corepack.cmd pnpm --dir web exec eslint server/config.ts server/application.ts server/workflows/worker-entry.ts tests/unit/config.test.ts tests/unit/application.test.ts --max-warnings=0` | Passed. |
| `corepack.cmd pnpm --dir web test:foundation` | Failed before collection: `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_MIGRATION_URL`, `TEST_DATABASE_APP_URL`, `TEST_DATABASE_WORKER_URL` are all unavailable to the runner. No missing credentials were fabricated or printed. |
| Targeted `git diff --check` | Passed for changed application/test files. |

**T093 is partial and remains unchecked.** Complete the environment example
when permitted and run the non-skipped foundation gate with isolated PostgreSQL
test roles/URLs before T009. No story implementation, provider transport/read
allowlist, new no-rail agent behavior, full regression acceptance, browser/manual
checks, live supplier access or deployment is claimed. Dependencies were not
changed or installed by this increment.

### Foundation provisioning and clean retest (2026-10-19)

At the user's request, started the installed Docker Desktop engine and verified
it was responsive. Existing `onholidai-postgres-1` on port 5432 was not modified.
Created a separate container `onholidai-foundation-277b2eec` from the already
available `postgis/postgis:18-3.6` image, with a session ownership label,
loopback-only random host port, tmpfs data and synthetic administrator password.
Verified PostgreSQL 18.6 readiness and loaded the repository's four synthetic
roles from `infra/postgres/test-roles.sql` with `ON_ERROR_STOP=1`.

Set `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_MIGRATION_URL`,
`TEST_DATABASE_APP_URL` and `TEST_DATABASE_WORKER_URL` only in the PowerShell
test process. No machine/user environment variables or credential files were
created. Each fixture still creates/drops its own isolated test database.

- First `corepack.cmd pnpm --dir web test:foundation`: all 43 assertions passed,
  but five unhandled `57P01` errors failed the run during force-drop cleanup.
  Installed `pg-pool` can resolve `end()` before client shutdown completes.
- Waiting only for the fixture's own client `end` events reduced errors to one,
  revealing the same lifecycle race for other short-lived test pools.
- Final fix: after destroying the fixture database handle, poll PostgreSQL's
  client-session state with a five-second deadline and 25ms polling interval.
  Once disconnected, use ordinary `DROP DATABASE`, not `WITH (FORCE)`. An actual
  connection leak throws explicitly; administrator pool closure is in `finally`.
  No errors are swallowed, no fixed grace sleep substitutes for state evidence,
  and no dependency/application code or database roles were relaxed.
- Final `corepack.cmd pnpm --dir web test:foundation`: **4 files passed,
  43 tests passed, zero skipped and zero unhandled errors**, exit 0.
- `corepack.cmd pnpm --dir web typecheck`: passed.
- `corepack.cmd pnpm --dir web exec eslint tests/helpers/database.ts --max-warnings=0`:
  passed.
- The Vite extensionless-config-import warning is pre-existing/nonfatal and
  was not suppressed or changed.

The database gate is now demonstrated, not skipped. T093 remains incomplete only
because a fresh read of `.env.example` is still denied by the tool's explicit
`Read(**/.env.*)` access rule, even after the user's confirmation. No alternate
tool or path was used to bypass that denial. The example was not modified.
Current product transports/read allowlists/rail outcomes/agent behavior and live
provider acceptance are not established by the 43 foundation tests.

The session-owned disposable database container is removed after validation;
the existing application database and Docker Desktop remain running. The
operations guide includes reproducible disposable provisioning commands.

### T093 completion after user-performed example update (2026-10-19)

The user confirmed that they changed `.env.example` following the supplied
replacement. Accepted that user-performed change as confirmation; a fresh read
is still denied, so no claim of independently inspecting the saved file is made
and no alternate access path was used. Removed the obsolete current blocker in
the operations guide and marked T093 complete, preserving earlier attempts as
historical evidence.

- Re-ran `corepack.cmd pnpm --dir web test tests/unit/config.test.ts tests/unit/application.test.ts`:
  21 passed across 2 files, zero skipped.
- Re-ran `corepack.cmd pnpm --dir web typecheck`: passed.
- Targeted ESLint on configuration, application, worker entry, both unit files
  and database helper: passed with zero warnings.
- Ran the exact recommended supplier JSON with empty Duffel read/transaction
  keys and empty shared Viator key through `loadServerConfig` and
  `deriveProviderReadiness` using a stdin Node module under `react-server`
  conditions. All three product searches report `configured_unverified` in
  deterministic mode; blank keys do not establish live access.
- The earlier clean 43-test database-backed foundation pass remains the
  foundation evidence; no application implementation changed during closeout.

T093 is complete. T009-T092 remain unchecked; no product integration, new
no-rail agent behavior, booking workflow completion or live-provider approval is
implied. No extension hooks are configured.

### First US1 discovery increment (2026-10-19)

Continued with deterministic, read-only tests; the user's sandbox keys were not
read, printed or used. Checklist remained 16/16 checked; markers were not edited.

Implemented and tested:

- Product-keyed explicit available/no-matches/unconfigured/access-blocked/
  unsupported/rate-limited/deadline/error outcomes, safe reasons, bounded retry
  guidance and source mode. Missing sources are not reported as successful
  empty inventory. Unverified live operations cannot execute when product
  readiness is supplied by the existing internal search route.
- Independent Duffel flight/stay reads, retained partial results and explicit
  unsupported rail outcomes with no rail supplier identity, adapter call or
  fallback. Current deterministic composition is Duffel Flights/Stays and
  Viator activities. Deferred/replaced adapters are excluded from fresh reads;
  their historical records and reconciliation code remain untouched.
- Product-scoped normalization/provenance, rejection of oversized/malformed
  responses and ambiguous duplicate registrations, immutable caller queries,
  pre-truncation deduplication and an exact 32-offer allocation test (11 flight,
  11 accommodation, 10 activity).
- Eight-second source ceiling, request cancellation propagated from the route,
  no source call for pre-cancelled requests, timer/listener cleanup and ignored
  late completion. No read retries or provider transactions.

TDD evidence: the first expanded read/readiness contracts produced 14 failures
and 6 passes. After implementing outcomes, the new composition regression
failed against the old four-provider defaults (1 failure/28 passes). Additional
readiness/options/cancellation regressions failed before wiring those options,
then passed with no unhandled errors. Final focused run:

`corepack.cmd pnpm --dir web exec vitest run tests/contract/supply-read.test.ts tests/contract/provider-readiness.test.ts tests/unit/supply-read.test.ts tests/unit/config.test.ts tests/unit/application.test.ts`

Result: **53 passed across 5 files, zero skips**. Web typecheck and targeted
ESLint on changed source, route and tests passed.

Provisioned a new session-labelled, disposable PostgreSQL 18/PostGIS container,
with synthetic roles and four process-only test URLs. Existing application
PostgreSQL was untouched. Initial setup accidentally accepted the image's
temporary bootstrap Unix-socket server: all 40 database-backed assertions failed
at their initial connection, while 3 non-database checks passed. Retried using
TCP readiness (the final server, not bootstrap) and an actual host `SELECT 1`
before testing. Corrected the reproducible operations command accordingly.

- `corepack.cmd pnpm --dir web test:foundation`: **43 passed across 4 files**,
  no skips or unhandled errors.
- One combined affected-consumer run covering refinement, version propagation,
  guest planning, account linking, refinement/booking-auth API contracts and
  supplier/config/application/fixture tests: **76 passed, 1 failed across 12
  files**, no skips. The failure is
  `guest-planning.test.ts:31`: the initial setup snapshot lacks
  `departureOrigins`. That assertion occurs before `previewEdit` or any
  supplier search, in untouched setup persistence. It is an existing
  independent failure, not waived, hidden or fixed as part of supplier work.
- After simplifying a fixture and adding explicit current-provider/no-rail
  refinement assertions, re-ran the 11-file focused consumer subset on another
  disposable database: **73 passed, zero skips/unhandled errors**. This subset
  excludes the separate guest-setup file, whose earlier failure remains open;
  it is not a claim that the broader suite is green. Web typecheck and targeted
  lint passed again.
- All three owned disposable containers were stopped and removed, including on
  failure. No persistent test secrets, application migrations or new services.

This is only a bounded discovery-search increment. T009 remains partial:
nullable unknown facts, property variants, richer nested privacy and the actual
Viator HTTP allowlist still need coverage/implementation. T012 offer revisions,
detail/revalidation, research grants/routes, actual MCP, UI, provider wire
transports and booking work are not complete. No full task checkbox or live
operation was promoted on these results.

### Earlier environment baseline

- Bash resolves `node` to a Windows terminal alias; use `node.exe` and
  `corepack.cmd pnpm` for noninteractive commands.
- Python requires >=3.13,<3.14. The existing environment is usable without sync;
  T002 must resolve FastMCP and required transitives without unrelated upgrades.
- Docker Desktop's Linux engine must be running before database/Temporal checks.
  Isolated admin, migration, application and worker test database URLs are required
  by the quickstart. Their values were not inspected or printed.
- Browser acceptance needs seeded synthetic sessions and running local services.
- Provider account approvals, approved documentation, quotas and per-operation
  access must be recorded separately; configured credentials do not prove access.
- `.specify/extensions.yml` is absent; no before/after implementation hooks are
  registered at baseline.