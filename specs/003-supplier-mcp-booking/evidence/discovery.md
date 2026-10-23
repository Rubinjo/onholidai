# Four-step supplier discovery evidence

This records the requested bounded discovery implementation, not completion of
all feature 003 tasks, production readiness, or supplier access approval.

## 2026-10-23 T028/T031/T032 discovery acceptance

T028, T031 and T032 are now complete. This supersedes their pending status in
the earlier execution entries below, not the independent live/booking gates.

### Stale responses and mobile reachability

Test-first component/hook cases reproduced wrong-trip response acceptance,
ignored stale-version results, missing read cancellation and event callbacks
after unmount. The existing query/event/research paths now reject those results,
propagate cancellation and display stale labels. The regression also resolves
the genuinely superseded request rather than an unrelated deferred promise.
Accepted trip facts, dirty editor input and revision guards remain intact.

The new real browser journey reproduced mobile research buttons underneath the
booking footer. A percentage-height conversation expanded past its grid row.
Only the mobile chat minimum is reset to automatic sizing; desktop three-pane
layout and the existing price/booking placement are unchanged. All interaction
checks use ordinary clicks, not forced clicks or hidden checkout bypasses.

### Executed commands and results

All database checks used synthetic roles in an isolated disposable PostGIS 18
cluster. Browser services used deterministic providers, no supplier keys and a
separate migrated browser database; the agent explicitly disabled environment
file loading. Restricted environment files and the application database were
not inspected or modified.

| Check | Final result |
| --- | --- |
| All web contracts plus supplier research access, offer research, workspace propagation and current config/application/provider fixture units | 281 passed / 24 files; zero skips |
| `pnpm test:contracts` | 226 web contracts and 41 Python contracts passed; zero skips; canonical exporters, snapshot and 16 shared supply cases passed |
| `pnpm --dir web test:foundation` | 44 passed / 4 files; zero skips or unhandled errors |
| `uv run --no-sync --project agent pytest agent/tests/integration/test_supplier_mcp.py agent/tests/contract/test_contract_export.py -q` | 45 passed; actual in-process four-tool MCP protocol and public exports |
| `pnpm --dir web exec playwright test tests/e2e/supplier-search.spec.ts --workers=1` | 10 passed; Chromium, Firefox, WebKit, mobile Chromium and mobile WebKit; no skips |
| Web typecheck, targeted ESLint and final changed-source Prettier | Passed |

The first browser case is an actual web-to-agent-to-MCP-to-persisted-research
journey. It verifies current product attribution, mixed and rail-only outcomes,
detail and deterministic revalidation, unchanged trip/version, stale-run
rejection, private access and no browser prebook/payment/booking requests.
Deterministic providers are not calls to the real Nuitee upstream mapper; its
mocked-wire persistence and zero-transaction checks remain separately covered
by T097 and the final contract/integration suites.

The second browser case deliberately intercepts public research reads and
revalidation results. At **320px** it verifies no horizontal page overflow,
partial flight failure, activity no-matches, unknown multi-room price/instants,
nationality/occupancy prerequisites, unsupported revalidation and original
saved Duffel stay attribution without trip mutation or checkout controls.
These browser fixtures are UI acceptance, not upstream fault injection.

Superseded attempts are not counted as passes: numeric-loopback Next dev HMR
blocked hydration; cold route compilation exceeded research polling; mobile
clicks exposed the layout defect; concurrent test workers later delayed the
synthetic service callbacks beyond the unchanged UI deadline. Final runs use
localhost, hydration readiness, the layout fix and one browser worker without
concurrent heavyweight tests. Detail assertions allow the existing endpoint
budget; production source/overall/polling deadlines were not increased.

### Controlled-clock SC-001 measurement

The existing supply-read contract now executes **20 search samples** with
deterministic current-source adapters. Delays increase by sample and source;
the final two Nuitee sources deliberately never resolve. Completion time is
captured when the search resolves, before advancing the remaining fake time.
Nearest-rank **p95 = 8,000 ms** and **maximum = 8,000 ms**, asserted exactly as
well as against **10,000 ms p95 / 12,000 ms maximum** thresholds.

Timed-out stays remain explicit deadline outcomes; useful flights/activities
and unsupported rail survive. Each sample leaves no pending search timers and
does not mutate its query. Persisted/browser suites independently verify no
trip mutation or transaction. This measures the controlled supplier-search
boundary, not cold compilation, browser journey duration, deployed network
latency, real supplier performance or participant acceptance.

No live access or consequential operation is activated. Nuitee final
revalidation remains unsupported; prebook/payment/booking stay excluded.
Nuitee Flights/Experiences and historical Duffel stay refresh remain inactive.
Participant outcomes, remaining feature tasks and full booking acceptance are
unrun. Next dev also reported a known-vulnerability dependency warning; no
unrelated dependency upgrade or security certification was performed.

## 2026-10-23 confirmed configuration and foundation retry

### Subsequent T097/T098 persisted certification

Completed the missing persisted Nuitee wire journey with the real HTTP mapper
against mocked rates/property responses and isolated PostgreSQL. Two rooms with
an explicit child allocation and sourced session/room/rate IDs survive storage
and owner/active-run reads. Changed public total/refund/meal facts append a new
revision while the original remains unchanged. Fresh rates/detail stay
estimated/incomplete, with no invented checkout expiry or live-revalidated
status. Final revalidation is unsupported and makes zero provider HTTP calls.
A separate saved-expiry fixture returns expired evidence; it is not a claim
about Nuitee rate lifetime. Trip version/proposals/booking writes remain unchanged.

A new UI regression first failed on the obsolete "stays from Duffel" introduction;
the existing copy now correctly names Nuitee. Final T098 run: **44 foundation
tests / 4 files**, **277 current web tests / 24 files**, **45 Python MCP/export
tests**, all with no skips. Canonical drift/shared cases, web/Python types,
targeted lint and changed-test formatting passed. No migration/dependency or
new service was added. T097/T098 are checked; T028/T031/T032 remain next.
Actual MCP uses its in-process protocol with mocked web callbacks, not a
deployed database-to-MCP E2E claim. No live supplier, prebook, payment, booking,
browser-E2E, latency or human acceptance was performed by this increment.

The user confirmed completing the requested manual configuration updates.
Environment files remain uninspected and untouched by the assistant. Added a
regression for the exact supplied single-line JSON; deterministic mode does not
verify access, and Nuitee final revalidation/booking remain blocked.

Created an isolated disposable cached PostGIS 18 cluster with the repository's
synthetic roles, not the application database. The foundation suite reproduced
four estimate failures from its obsolete Duffel Stays fixture. Corrected that
fixture to Nuitee and asserted the current sources; final foundation:
**44 passed / 4 files, no skips/unhandled errors**.

The final current-supplier run included all web contract tests, persisted
supplier access, browser research component and config/application/provider/
discovery units: **276 passed / 24 files, no skips**. Persisted checks now cover
current product attribution, browser/active-run reads of Nuitee evidence,
independent Nuitee failure with retained flights/activities, and unchanged
historical Duffel stay attribution with blocked refresh and no fallback or
accepted-trip/proposal/booking mutation.

Actual FastMCP protocol suite: **41 passed**, including the shared canonical
Nuitee multi-room fixture through all four tools and partial/unsupported/changed/
expired result transport. Those callbacks are mocked, not an actual
database-to-MCP end-to-end certification. Separate Python canonical tests:
**41 passed**. Generated drift/shared fixtures, web/Python types, targeted lint
and changed-test formatting passed. See the
[verification ledger](provider-readiness.md#2026-10-23-manual-confirmation-and-foundation-closeout)
for commands, the initial superseded skipped contract run and boundaries.

T095/T017/T096 are complete. T097 still needs the complete persisted Nuitee
wire-level expired/changed/multi-room journey; T098 and remaining discovery/
booking acceptance stay unchecked. The earlier missing-database and manual
confirmation entries below are historical, not current blockers. No live
supplier call or consequential activation was performed.

## 2026-10-23 Nuitee read correction increment

Current composition is **Duffel Flights / Nuitee stays / Viator activities**.
The dated Duffel Stays evidence below describes the previous scope, not an
active fallback or approval for Nuitee.

- Added environment-specific Nuitee readiness and safe fixed-host rates/property
  reads with trusted nationality/location/exact room-allocation prerequisites.
  Read paths contain no prebook, payment or booking calls. Final live stay
  revalidation remains unsupported; incomplete discovery cannot materialize
  an accepted component or authorize checkout.
- Preserved multi-room rate/room/offer IDs and optional sourced session, exact
  array-valued pricing and nested included/excluded charges. Public pricing is
  sourced SSP plus known same-currency property fees, with no invented margin,
  exchange rate, instant or expiry. Unknown fees and restricted package/member
  rates keep total unknown. Unsupported large/material-term shapes fail
  explicitly within existing canonical size limits.
- Both application modes now exclude inactive products. Original Duffel stay
  evidence remains readable with unchanged attribution, and cannot be refreshed
  through Nuitee or an injected legacy adapter.
- Added a shared public Nuitee multi-room fixture accepted by web and Python,
  plus browser-panel coverage for useful Nuitee evidence alongside failed flight
  access and unsupported final revalidation, without accepted-trip mutation.
  This component test is not a database-backed/browser-E2E certification.

Final focused web command selected the Nuitee/supply read, application/config,
readiness/deferred/provider fixture/discovery, retained Duffel/Viator HTTP,
transaction contract, agent schema and offer-research component files:
**228 passed across 15 files, zero skipped**. Nuitee wire subset: **22 passed**.
`uv run --no-sync pytest tests\contract\test_contract_export.py
tests\integration\test_supplier_mcp.py -q` from the agent directory:
**41 passed**, including actual in-process MCP protocol tests. This does not
establish the new provider's persisted four-tool journey.

Web typecheck, targeted ESLint, Python Pyright/Ruff, snapshot/supply and agent
drift checks and `node scripts\validate-contracts.mjs` passed; shared supply
cases now total 16. No dependencies or database migrations were added.

`corepack pnpm --dir web test:foundation` was attempted but **failed before
collection** for all four missing isolated `TEST_DATABASE_*_URL` credentials.
No database skip or historical green result is substituted for the required
current foundation gate. The access-restricted environment example was neither
read nor edited; the user approved the exception, and its manual update still
needs confirmation. T094 is checked; T095/T017/T096-T098 retain their incomplete
dependency/integration gates. No live access, new transactions, latency
percentiles, human acceptance or full feature completion is claimed.

## Historical discovery implementation and verification

Only synthetic data and an independently provisioned disposable PostGIS cluster
were used. No environment file, real key, supplier sandbox endpoint,
reservation, order, payment, cancellation or reschedule was exercised.

## Implemented behavior

1. Canonical Zod discovery schemas retain unknown source dates, details, terms,
   customer totals, taxes and fees as null. Offers carry source/evidence mode,
   immutable references/revisions and query/party fingerprints. Legacy missing
   evidence stays unknown. Accepted components remain strict; TypeScript and
   Python planning reject incomplete/expired/unavailable materialization.
2. Migration 014 adds research runs and immutable revisions without editing
   migrations 001-013 or widening proposal purposes. Searches persist original
   per-product query evidence. Detail/revalidation use bounded provider reads
   outside database transactions, recheck ownership/current-version/source
   revocation afterward and append revisions using compare-and-swap. Only the
   latest search's references/outcomes are listed, including repeated searches
   within one run. Completed browser access is distinct from active internal
   run grants. Both repository and database reject research-linked proposals.
3. Exactly four real in-memory FastMCP tools use immutable trusted context,
   closed arguments, signed callbacks, canonical public schemas and safe
   bounded results. The workspace starts research through existing run
   creation, compares safe source facts, inspects/rechecks revisions and ignores
   cancelled, old-version or lower-revision results. It never accepts changes
   or reserves inventory. Unsupported rail preserves supported results; Python
   keeps explicit required-rail constraints unresolved rather than inventing a
   replacement.
4. Duffel Flights/Stays and Viator have fixed-host, fixed-endpoint read HTTP
   clients with injected read credentials and trusted location/party resolvers.
   Synthetic wire tests cover response mappings, money bounds, independent
   product failure, forbidden transactional forwarding and abort-listener
   cleanup on success/failure/cancellation/deadline. The application composes
   only independently verified live products, without fake live fallback.

## Executed verification

Commands run from the repository root; database commands use only the four
synthetic `TEST_DATABASE_*_URL` values in their PowerShell process. The fixture
helper creates/drops a unique database for each case.

| Check                                                                                                  | Executed result                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Final web supplier/access/UI/config/refinement/agent-schema run, Vitest `--maxWorkers=2`               | 154 passed across 15 files, zero skipped                                       |
| `corepack.cmd pnpm --dir web test:foundation --maxWorkers=2`                                           | 43 passed across 4 files, zero skipped/unhandled errors; migration 014 applied |
| Final query-scoping/UI/agent-schema follow-up, Vitest `--maxWorkers=2`                                 | 51 passed across 5 files, zero skipped                                         |
| Provider HTTP wire subset (included in the focused run)                                                | 44 passed; no external HTTP                                                    |
| Python offer-completeness, integration, estimate evaluation, refinement/model/schema/API/export subset | 101 passed; includes actual MCP list/call and no-rail regressions              |
| `corepack.cmd pnpm --dir web typecheck` and focused ESLint                                             | Passed                                                                         |
| Targeted Python Ruff and Pyright                                                                       | Passed; zero type errors/warnings                                              |
| `node --experimental-strip-types scripts\validate-contracts.mjs`                                       | Passed, including 15 shared supply cases                                       |
| `corepack.cmd pnpm --dir web snapshot:contract:check`                                                  | Passed for accepted snapshots, itinerary and internal/public discovery         |
| `corepack.cmd pnpm --dir web agent:contracts:check` and Python exporter `--check`                      | Passed                                                                         |

Reproducible Python subset:

```powershell
uv run --directory agent pytest tests\unit\test_planning_offer_completeness.py tests\integration tests\evaluation\test_estimates.py tests\contract\test_refinement_tools.py tests\contract\test_agent_models.py tests\contract\test_schema_compatibility.py tests\contract\test_estimate_api.py tests\contract\test_contract_export.py -q
```

New discovery test targets:

- `web/tests/unit/discovery-offers.test.ts`
- `web/tests/integration/supplier-research-access.test.ts`
- `web/tests/integration/offer-research.test.tsx`
- `web/tests/contract/supplier-research-api.test.ts`
- `web/tests/contract/{duffel,duffel-stays,viator,provider-http}-read.test.ts`
- `agent/tests/integration/test_supplier_mcp.py`
- `agent/tests/unit/test_planning_offer_completeness.py`

Initial tests exposed missing services/UI, product-query identity mismatch on
revalidation, missing shared-schema metadata, incorrect test button labels and
generic detail type erasure. Each was corrected and the relevant checks rerun.
Two initial Vitest worker startup timeouts under concurrent load were addressed
by bounded workers, not by changing application behavior. A guessed Python test
path failed collection; the verified command above uses the actual paths.

## 2026-10-20 contract, readiness and fixture increment

Completed T009, T013, T016 and T020; this is not the US1 checkpoint or full
feature acceptance.

- New contract/database tests first reproduced two failures: an active supplier
  was callable for the wrong product, and unsupported detail/revalidation could
  call the supplier and append a misleading successful revision.
- Search now rejects wrong active-provider/product pairings and respects adapter
  operation support. Refresh checks the selected product's support/access and
  mode, not Duffel's mode for Viator. Unsupported/blocked/unverified reads do not
  call the provider or append evidence; accepted trip version and transactions
  remain unchanged.
- Adapter read-operation support is separate from access configuration. Stays
  explicitly declares quote revalidation unsupported. Capability reporting
  cannot promote this to verified/supported from configuration alone, or enable
  an absent method. Query bounds, source/overall deadlines and safe limitations
  are reported; unestablished property, market/party, rate and maximum-age limits
  remain null. Viator is a valid transaction adapter identity, but no worker
  dispatch or transaction capability is enabled by that type addition.
- Four property-variant regressions first failed for missing evidence, then
  passed for hotel/apartment/villa/hostel synthetic fixtures across search,
  detail, revalidation and expiry with a controlled clock. Anonymous adult slots
  remain stable across products/dates, and child age-at-trip-start does not
  establish service-date eligibility. Missing source dates remain null.
- Nested credential/economics/identity/payment canaries are absent from public
  results. Deferred Booking.com/Trainline and replaced GetYourGuide never supply
  fallback inventory; rail-only/mixed outcomes remain explicitly unsupported.
  Saved provider identities and injected legacy confirmation/status responses
  are preserved without executing writes. Restricted legacy dispatch guards
  remain T068, not established by these read-compatibility tests.

After user approval, provisioned a new session-owned disposable PostgreSQL
18/PostGIS container with synthetic roles from `infra/postgres/test-roles.sql`.
The running application database was not modified. The four test URLs existed
only in each runner's process; no environment file or supplier credential was
read. An initial run without those URLs failed before collection, then the
isolated foundation rerun passed.

| Executed check                                                                            | Result                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `corepack.cmd pnpm --dir web test:foundation` with isolated test URLs                     | 43 passed across 4 files, zero skips              |
| Final affected web subset below, with isolated test URLs and `--maxWorkers=2`             | 142 passed across 17 files, zero skips            |
| `uv run --project agent --no-sync pytest agent\tests\integration\test_supplier_mcp.py -q` | 37 passed, zero skips; actual list/call protocol  |
| `corepack.cmd pnpm --dir web typecheck`                                                   | Passed                                            |
| ESLint on the changed supply sources and tests with `--max-warnings=0`                    | Passed                                            |
| `corepack.cmd pnpm --dir web snapshot:contract:check`                                     | Passed; no generated snapshot/supply schema drift |

Reproducible final web selectors (provision isolated URLs as in the operations
guide first):

```powershell
corepack.cmd pnpm --dir web test --maxWorkers=2 `
  tests\contract\provider-readiness.test.ts tests\contract\supply-read.test.ts `
  tests\contract\duffel-read.test.ts tests\contract\duffel-stays-read.test.ts `
  tests\contract\viator-read.test.ts tests\contract\provider-http-read.test.ts `
  tests\contract\deferred-suppliers.test.ts tests\contract\supply-transactions.test.ts `
  tests\contract\supplier-research-api.test.ts tests\unit\supply-read.test.ts `
  tests\unit\provider-fixtures.test.ts tests\unit\discovery-offers.test.ts `
  tests\unit\application.test.ts tests\integration\supplier-research-access.test.ts `
  tests\integration\offer-research.test.tsx tests\integration\estimate.test.ts `
  tests\integration\refinement.test.ts
```

The editor test tool did not discover the selected Vitest fixture test; the
repository's Vitest command above executed it successfully instead. No new
tooling or dependencies were installed.

Public Duffel Stays documentation was rechecked: the
[integration guide](https://duffel.com/docs/guides/getting-started-with-stays)
separates search, room rates, final quote and booking, but does not establish
this deployment's quote no-hold/read-token permissions. This pass did not
enable quotes or contact supplier APIs. T017-T019 remain unchecked for their
full mapping requirements; later discovery, recommendation, booking, browser,
human and activation gates remain open.

## 2026-10-20 supplier wire mapping increment

Completed T018 and T019 implementation. This supersedes the preceding increment's
mapping status, not its separate live-access or full-feature gates.
T017 remains partial and T021 remains unchecked.

- Duffel Flights retains bounded fare brands, cabin/fare-basis/baggage facts by
  anonymous passenger index, payment/identity/additional-service prerequisites
  and expiry/current-price evidence. Supplier passenger and payment identifiers
  are not forwarded. Offset-free local service times use the existing
  `qualifiedInstant` policy only with sourced airport timezone evidence;
  invalid/missing zones and ambiguous/nonexistent DST instants stay null.
  Base plus tax does not prove service/payment fees are zero; fees and complete
  customer totals remain unknown without the required facts.
- Duffel Stays validates sourced room count and adult/child-age occupancy
  against the trusted query, preserving absent occupancy as unknown. Rate
  methods, mandatory conditions and cancellation refund timelines are retained.
  The inspected official accommodation/room/rate schemas do not establish
  property type, room ID or quote deposit facts; these remain unknown. Quote
  creation/revalidation is still unsupported because no deployment-approved
  no-hold/read-key permission has been established. No write-key fallback exists.
- Viator retains bounded product options, cancellation-policy/refund windows,
  confirmation and age-band facts, booking-question count and unverified-answer
  prerequisite evidence, without answers, traveller identities, unrestricted
  supplier contact text or net prices. Availability checks require exact-day
  and trusted party evidence. Zero available options maps to unavailable; one
  retains its identity; multiple retain option summaries with unresolved
  selection rather than picking arbitrarily. Missing trusted age-band mapping
  declares revalidation unsupported.
- Viator recommended retail, sourced mandatory destination extras and retail
  inclusive of extras are retained separately in the response currency.
  Inclusive retail already includes the extras: they are not added again.
  Numeric `totalExtraCharges` preserves its original JSON token before integer
  scaling, rejecting sub-minor precision instead of rounding it away. Taxability
  and exemption flags do not establish tax amounts, collection responsibility
  or approved complete customer totals. Absent mandatory amounts remain null.
- Wire availability survives normalization and search persistence. Saved reads
  no longer label unknown/unavailable evidence as available. A database
  regression exercises the real Viator read adapter with synthetic transport
  through content-only search, unknown detail and unavailable revalidation:
  immutable revisions retain the three evidence states, original revisions
  remain readable, accepted trip version is unchanged, and zero proposals or
  booking transactions are created.
- Safe source facts use the existing 2,000-character public-summary boundary.
  Oversized mappings fail explicitly as unsupported, not by dropping material
  terms. No second offer model or arbitrary supplier forwarding was introduced.

Public supplier schemas were inspected directly: Duffel structured API
documentation/official JavaScript types and Viator's embedded OpenAPI schemas.
An AI search summary was not used as authority for undocumented fields or
permissions. The source docs do not establish deployment access. All executed
supplier transports used synthetic data; no supplier API or key was exercised.

Test-first checks reproduced eight missing wire mappings initially, then two
additional precise-money/destination-extra failures. The persisted-evidence
regression also reproduced the saved-read availability bug before its fix.
An initial typecheck rejected unparsed JSON database assertions; those now
use the existing canonical normalizer instead of type casts.

| Executed check                                                                                             | Result                                         |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Provider wire subset: `duffel-read`, `duffel-stays-read`, `viator-read`, `provider-http-read`              | 53 passed across 4 files; included below       |
| Same 17-file web selector command recorded above, with isolated test URLs and `--maxWorkers=2`             | 152 passed, zero skips                         |
| `uv run --project agent --no-sync pytest agent\tests\integration\test_supplier_mcp.py -q`                  | 37 passed, zero skips; real list/call protocol |
| `corepack.cmd pnpm --dir web typecheck` and ESLint on changed supply sources/tests with `--max-warnings=0` | Passed                                         |
| `corepack.cmd pnpm --dir web snapshot:contract:check`                                                      | Passed                                         |
| `node --experimental-strip-types scripts\validate-contracts.mjs`                                           | Passed; includes 15 shared supply wire cases   |

The 17-file run used a new session-owned disposable PostgreSQL 18/PostGIS
container and four process-only synthetic test-role URLs. Its fixture databases
and the owned container were removed after verification; the healthy application
database was not changed. No dependencies were installed, no implementation
extension hooks are configured, and unrelated worktree changes are preserved.
These checks are not browser/participant acceptance, production latency evidence
or supplier activation approval.

## 2026-10-21 bounded discovery and composition increment

The user approved continuing remaining US1 code/tests despite the T017
dependency, with Stays quote/revalidation still blocked and T017 unchecked.
Rechecked the public Duffel Stays integration guide and quote reference; neither
establishes this deployment's no-hold/read-key permission. No quote transport or
privileged fallback was added. This exception is not US1 acceptance or live
approval.

Completed T021 and verified the existing T026 composition:

- Search allocates the shared 32-offer budget across products, then
  requirement/selection groups within each product. A return-leg offer behind
  31 outbound offers remains visible; another flight adapter does not receive a
  second product budget share. Deduplication happens before allocation.
- Search/detail/revalidation share one small rate-directed retry helper. No
  ordinary failure or absent guidance triggers a retry. A trusted rate-limit
  delay must fit the original eight-second supplier budget; at most one retry
  uses that same deadline and abort signal. Cancellation clears the wait and
  prevents the second supplier call. A slow retry is aborted at eight seconds,
  not eight seconds after the retry.
- Evidence refresh now applies the twelve-second request guard across access
  and persistence boundaries and returns an explicit 504 for caller
  cancellation rather than a success-shaped unknown result. Cancelled work
  cannot append evidence. This does not certify SC-001 latency percentiles or
  elapsed-time bounds during infrastructure failures.
- Known-stale revisions are rejected before supplier reads. Concurrent reads
  still compare-and-swap under the source-run lock: exactly one next revision
  commits and the other conflicts. Original revisions remain readable, trip
  version is unchanged and no booking transaction is created.
- Existing deterministic/live roots remain Duffel Flights/Stays and Viator
  activities only. Independent readiness, missing/blocked lanes, explicit rail
  deferral, absence of synthetic live fallback and preserved legacy attribution
  passed the readiness/application/deferred-supplier/fixture regressions. A
  client factory or key does not establish verified access.

Test-first runs reproduced six search failures and two database-backed refresh
failures before implementation. The editor test tool found no tests, so the
repository's existing Vitest runner was used. Docker was initially stopped;
starting the installed Docker Desktop restored the engine. A new session-owned
PostgreSQL 18/PostGIS container with synthetic roles supplied all four test URLs
in runner processes only. The application database and environment files were
not read or changed.

| Executed check                                                                                 | Result                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Same 17-file web selector command recorded above, with isolated test URLs and `--maxWorkers=2` | 162 passed, zero skips                           |
| Final search/persistence rerun after stale-read assertion and cancellation checks              | 44 passed across 2 files, zero skips             |
| `corepack.cmd pnpm --dir web test:foundation` with isolated test URLs                          | 43 passed across 4 files, zero skips             |
| `uv run --project agent --no-sync pytest agent\tests\integration\test_supplier_mcp.py -q`      | 37 passed, zero skips; actual four-tool protocol |
| Web typecheck and targeted ESLint with `--max-warnings=0`                                      | Passed                                           |
| Snapshot contract drift and `scripts\validate-contracts.mjs`                                   | Passed, including 15 shared supply wire cases    |

The foundation runner emitted the existing warning about a future Vite native
config loader requiring an explicit import extension; it did not fail or skip
tests. No dependencies, migrations, generated contracts or UI were changed.
T017/T028/T031/T032 remain open, as do recommendations, booking, external and
human acceptance gates. This is not a full-suite-green or latency certification.

## Separate pending gates

- Supplier sandbox/live operation-specific approvals and executed evidence.
  Keys alone do not establish permission or verified readiness.
- Stays quote implementation/tests, restricted read-token permission, full
  mandatory amounts and trusted room allocation. On 2026-10-21 the user supplied
  quote-only side-effect confirmation and approved conditional implementation
  and a separate-read-token sandbox probe; see the
  [approval ledger](provider-readiness.md#t017-conditional-implementation-approval-2026-10-21).
  The initial research runner had no loaded credential. A subsequent explicitly
  authorized `.env` sandbox probe returned HTTP 403 for read-token search;
  all-rates/quote could not run without granted inventory. The
  [executed probe](provider-readiness.md#authorized-sandbox-read-token-probe-2026-10-21)
  records safe support references and the still-unconfirmed denial cause.
  A subsequently authorized standalone diagnostic with the distinct sandbox
  transaction token also returned HTTP 403; see
  [transaction-token evidence](provider-readiness.md#explicit-transaction-token-diagnostic-2026-10-21).
  Switching tokens did not resolve Stays search access.
  Quote/revalidation remains unsupported in current code, not live-approved.
- Viator complete customer pricing, actual product age-band mapping, API tier,
  exact-day availability and production entitlement. Default host is sandbox.
- Trusted supplier location mappings. Default mappings use authoritative saved
  `duffel:flight` / `viator:destination` provider IDs, never arbitrary tool IDs.
- Property-filter and requirement-selector coverage beyond the explicit
  unsupported outcomes; booking and transaction workflows remain separate.
- Full browser journey, manual keyboard/320px checks, participant evidence and
  SC-001 p95/all-request certification. Source reads have eight-second bounds
  and search cancellation uses a twelve-second overall guard, but these tests
  are not production latency measurements.
- The previously recorded unrelated guest-setup `departureOrigins` failure
  remains open; no full-suite-green claim is made.

The session-owned disposable cluster was removed after final verification.
Existing application databases and unrelated worktree changes are preserved.
No implementation extension hooks are configured.

## Read transport boundary and source documentation

Only these methods/paths can leave the read clients; IDs must have been granted
by a prior search for the same validated query. Redirects and arbitrary
URL/method forwarding are disabled.

| Product                | Fixed read allowlist                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Duffel Flights, API v2 | `POST /air/offer_requests?return_offers=true`; `GET /air/offers/{offerId}`                  |
| Duffel Stays, API v2   | `POST /stays/search`; `POST /stays/search_results/{searchResultId}/actions/fetch_all_rates` |
| Viator Partner API 2.0 | `POST /products/search`; `GET /products/{productCode}`; `POST /availability/check`          |

Duffel uses `https://api.duffel.com` with `Duffel-Version: v2`. Viator uses only
`https://api.viator.com/partner` or
`https://api.sandbox.viator.com/partner`. Each HTTP operation has an eight-second
maximum timeout, a 16-KiB request and 1-MiB response bound, and no retry.

Mappings were grounded in official documentation, not account approval:

- [Duffel Offer Requests](https://duffel.com/docs/api/v2/offer-requests)
- [Duffel Offers](https://duffel.com/docs/api/v2/offers)
- [Duffel Stays guide](https://duffel.com/docs/guides/getting-started-with-stays)
- [Duffel Stays Search](https://duffel.com/docs/api/v2/search/stays-search)
- [Duffel Fetch All Rates](https://duffel.com/docs/api/v2/search-result/fetch-all-rates)
- [Viator Partner API technical documentation](https://docs.viator.com/partner-api/technical/)

Current wire coverage is one destination; Flights needs an airport origin and
round-trip dates. Offset-free source flight timestamps require sourced timezone
qualification; unresolved or ambiguous instants stay unknown. Viator availability
needs one exact day and trusted party evidence; multiple options stay unresolved
rather than silently selecting one. Stays rate detail is not quote creation or
revalidation.
