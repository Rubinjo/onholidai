# Provider implementation and access evidence ledger

Date: 2026-10-18. Contract: [provider-readiness](../contracts/provider-readiness.md).

## Current scope revision (2026-10-23)

Current targets are Duffel Flights, Nuitee stays and Viator activities. The
dated Duffel Stays approvals/probes and older "current scope" sections below
are preserved historical evidence, not instructions to reactivate that lane.
User reports Duffel Flights-only access and Nuitee access; no credentials or
authenticated requests were inspected/executed in this revision.

| Product                      | Implementation evidence                                                                                                                                           | Provider-test / live approval                               | Remaining gate                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Duffel Flights               | Existing mapped read client; historical synthetic tests only                                                                                                      | No new certification                                        | Existing per-operation prerequisites remain                                                                                                                                                |
| Nuitee stays                 | Fixed-host rates/property-detail client; 22 synthetic wire cases, persisted multi-room revision/privacy certification and five-project deterministic browser acceptance; foundation passed | User-reported access only, operation/environment unverified | Trusted nationality/occupancy, live operation approval, prebook safety, exact pricing/payment path, booking/status correlation |
| Viator activities            | Existing mapped read client; historical synthetic tests only                                                                                                      | No new certification; booking-tier entitlement unverified   | Actual merchant booking/status permission and trusted prerequisites                                                                                                                        |
| Duffel Stays                 | Historical implementation/probes below                                                                                                                            | Not a current activation target                             | Preserve saved provenance/approved reconciliation; disable new discovery/refresh/book writes                                                                                               |
| Nuitee Flights / Experiences | Evaluated in [research](../research.md#2026-10-23-provider-selection-revision), not selected                                                                      | Not checked or required                                     | Separately approved future scope, no fallback                                                                                                                                              |

Nuitee hotel prebook is documented checkout-session creation, not established
read-only revalidation. Keep it excluded unless a no-hold/no-payment variant
is explicitly evidenced. Unsupported revalidation blocks whole-trip stay
authorization, not unrelated discovery. Reusable prebook IDs do not prove
idempotency. Read implementation is not live activation or a successful provider
probe.

### Subsequent discovery acceptance

T028/T031/T032 are complete; see the
[execution record](discovery.md#2026-10-23-t028t031t032-discovery-acceptance).
Final results: 281 current web tests / 24 files, 226 web and 41 Python
contracts, 44 foundation tests, 45 actual MCP/export tests and 10 browser cases
across all five projects, without skips. Browser fault/prerequisite/legacy cases
use explicit UI fixtures at 320px; the separate real deterministic browser
journey exercises actual MCP and persisted reads. Controlled-clock search
p95/maximum are both 8,000 ms, not measured live or browser latency. These
results do not change any provider/environment/operation approval above.

## 2026-10-23 manual confirmation and foundation closeout

### Subsequent T097/T098 persisted certification

The earlier incomplete T097/T098 status below is superseded by this execution.
Reused the synthetic Nuitee response in the existing provider fixture module.
The production HTTP mapper, with mocked fetch and an isolated database, now
round-trips selected multi-room/child allocation, sourced session/rate/room IDs,
exact SSP plus property charges, changed refund/meal/customer-price facts and
immutable original revisions through persisted owner and active-run reads.
Fresh detail remains incomplete (`unknown`, estimated, no service instants or
invented expiry); unsupported final revalidation issues no HTTP. A separate
seeded saved-evidence expiry fixture returns expired status without claiming
that the Nuitee rates API supplies a checkout deadline. No accepted trip,
proposal or booking mutation occurs. The fixed three-request trace is rates,
property data and rates again, never prebook/payment/booking.

The existing research introduction still named Duffel for stays. A failing UI
regression reproduced that mismatch before the copy was corrected to Nuitee.
No layout or interaction redesign was introduced.

| T098 executed check | Result |
| --- | --- |
| Isolated `pnpm --dir web test:foundation` | 44 passed / 4 files; zero skips/unhandled errors |
| All web contracts plus current supplier access/browser-panel/config/application/provider/discovery suites | 277 passed / 24 files; zero skips |
| Actual FastMCP protocol plus Python canonical export tests | 45 passed; zero skips |
| Agent/snapshot/promoted contract drift and shared supply validation | Passed; 16 wire cases |
| Web/Python typecheck, targeted ESLint/Ruff and changed-test formatting | Passed |

T097/T098 are complete. TypeScript persistence and actual MCP protocol are
tested at their existing boundaries; protocol callbacks remain mocked, not a
new deployed cross-process end-to-end test. T028/T031/T032, browser E2E, latency
and live supplier approvals remain independent. No secrets/environment files
were inspected; only synthetic roles in a separate disposable cluster were used.

The user confirmed all requested manual configuration updates. Restricted
environment files were not read or modified; this is user-performed confirmation,
not an independently inspected deployment. The supplied single-line JSON is now
covered by a configuration-loader regression with deterministic mode, no real
secrets, no verified access and blocked Nuitee final revalidation/book operations.

Docker was available on this retry. Provisioned a separate disposable
`postgis/postgis:18-3.6` container from the cached image using synthetic credentials
and `infra/postgres/test-roles.sql`, bound only to loopback. The existing
application database was untouched. The first foundation execution exposed four
estimate failures caused by its fixture still injecting retired Duffel Stays.
Replaced that fixture with Nuitee, retaining the essential-accommodation safety
check and asserting the current provider/product matrix.

| Executed check | Result |
| --- | --- |
| `pnpm --dir web test:foundation`, isolated synthetic test URLs | 44 passed / 4 files; zero skips or unhandled errors |
| Supplier access/browser component, all web contract tests, config/application/provider/discovery units | 276 passed / 24 files; zero skips |
| `pytest agent/tests/integration/test_supplier_mcp.py` | 41 passed; actual in-process FastMCP protocol |
| Python canonical contract suite via `pnpm test:contracts` | 41 passed |
| Canonical exports, agent/snapshot/promoted-contract drift, shared supply cases | Passed; 16 shared supply wire cases |
| Web TypeScript and Python Pyright | Passed; Python zero errors/warnings |
| Targeted ESLint/Ruff and changed-test Prettier/Black checks | Passed |

The first general contract command ran without database variables and skipped 13
database cases; the final 276-test run above includes all web contract tests with
the isolated credentials and no skips. That final run supersedes the skipped
result. The Vite future-native-loader notice remains a non-failing existing
warning.

New persisted tests prove current source identity and fair product ordering,
Nuitee evidence reads through owner and active-run contexts, independent Nuitee
outage results, unchanged trip version/no proposals/no booking transactions, and
original saved Duffel stay attribution with unsupported detail/revalidation and
no appended revision/fallback. New MCP cases exercise the canonical Nuitee
multi-room fixture through all four tools, including partial outcomes and
unsupported/changed/expired result transport. These MCP cases mock the trusted
web callback; they do not claim a database-to-MCP end-to-end journey.

T095/T017/T096 are complete. T097 remains incomplete for the full persisted
Nuitee wire-level expired/changed/multi-room journey, and T098 remains downstream
of it despite the now-green foundation check. Browser E2E/latency/human acceptance
and all live approvals remain separate. No supplier API, prebook, reservation,
payment or booking was called. The disposable test container is removed after
validation; no reusable real credential or service is left behind.

## 2026-10-23 Nuitee read correction verification

T094 regressions were run before the configuration/composition/client changes.
They reproduced rejected Nuitee declarations, absent Nuitee composition/client,
and inactive-product behavior. A later explicit deterministic-root test also
failed before the root adopted the same current-product matrix as live roots.
The official [Search OpenAPI](https://docs.liteapi.travel/openapi/api-search.json)
and [Hotel Data OpenAPI](https://docs.liteapi.travel/openapi/api-hotel-data.json)
were checked against the mapping. Offer-level totals/SSP are single-item arrays;
taxes/fees are inside `retailRate`. Property content uses `GET /v3.0/data/hotel`.
Only public documentation and synthetic fixtures were used.

Implemented boundaries:

- Canonical `nuitee` accommodation; retained Duffel flight/Viator activity.
  Both application modes reject inactive injected products; read selection
  cannot call legacy Duffel stays or Nuitee Flights/Experiences as fallback.
  Legacy Duffel evidence retains its original identity; refresh is unsupported.
- Explicit `NUITEE_ENVIRONMENT`, shared trusted-server reference support,
  environment-matching verification evidence and independent operations.
  Nuitee final revalidation/book/cancel/reschedule remain hard-blocked.
  Worker composition creates no read clients or new Nuitee transaction adapter.
- Trusted nationality, one mapped location, exact per-room adults/child ages;
  absent or inconsistent facts fail before HTTP. Rates/property detail only:
  fixed host/method allowlist, no redirects, bounded payloads/responses,
  six-second transport ceiling and inherited caller cancellation.
- Selected multi-room IDs, occupancy numbers, source session and exact
  minor-unit arithmetic; inconsistent sums/currencies/precision/occupancy
  fail explicitly. Sourced public SSP plus known same-currency property
  charges is estimated only; net economics/margin are never substituted.
  Included charges are not double-counted; absent fees, unsupported currency
  conversion and package/membership restrictions leave customer total unknown.
  Service instants/expiry/final payment and checkout terms are not invented.
- Query-bound property grants are in-memory and bounded; after restart/eviction
  a new search may be needed. Removed/changed offer IDs are not silently
  substituted. Existing persisted evidence remains readable.
- No prebook, payment or booking method/endpoint in the client. No assertion
  that checkout creation is a safe read or that a reusable prebook ID is
  idempotent.

| Executed check                                                                                            | Result                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused web supplier/config/composition/legacy/schema/browser-panel subset                                | 228 passed, 15 files, zero skipped                                                                                                               |
| Nuitee wire cases, included above                                                                         | 22 passed; synthetic HTTP only                                                                                                                   |
| Python contract-export and actual in-process MCP integration subset                                       | 41 passed, zero skipped; includes new shared Nuitee schema fixture                                                                               |
| Web TypeScript; Python Pyright                                                                            | Passed; Python zero errors/warnings                                                                                                              |
| Targeted ESLint; Python Ruff                                                                              | Passed                                                                                                                                           |
| Snapshot/internal/public supply and agent artifact drift; promoted contracts                              | Passed; 16 shared supply validation cases                                                                                                        |
| Current non-skipped foundation gate                                                                       | Blocked before collection: missing `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_MIGRATION_URL`, `TEST_DATABASE_APP_URL`, `TEST_DATABASE_WORKER_URL` |
| Persisted Nuitee browser/internal/MCP journey, browser E2E, latency percentiles, live provider operations | Not certified/run in this increment                                                                                                              |

The environment-example read was denied; the user approved proceeding with
accessible dependent work while T095 remains incomplete. The manual secret-free
update is documented in [operations](../../../docs/operations.md#supplier-readiness-configuration);
it has not been confirmed. Historical completed tasks and authenticated Duffel
observations below are preserved, not reused as Nuitee certification.

## Historical ledger introduction (2026-10-18)

This is an initial implementation ledger, not activation approval. No provider
credentials, account identifiers, passenger/payment data or raw payloads appear
here. No external provider calls were made. Public documentation does not prove
deployment access. Manual checks are deferred by user instruction, not passed.

## Status definitions

- `adapter`: an injected normalized client port exists; approved wire transport,
  complete feature behavior and commercial access are not established.
- `missing`: the required read operation is not exposed in the current read port.
- `conditional`: the transaction wrapper delegates only when the injected client
  declares support; no verified provider semantics or stock-worker composition.
- `synthetic`: deterministic search composition exists; not live evidence.
- `unverified`: no operation-specific executed evidence is recorded here.
- `blocked`: approved documentation/access/prerequisites are not established.

## Per-provider/per-operation status

### Historical baseline (2026-10-18, superseded supplier scope)

The rows below are preserved evidence of the prior implementation baseline, not
current provider targets or activation requirements. Booking.com and Trainline
are now deferred and GetYourGuide is replaced. The historical Duffel rows concern
Flights only; they do not establish Stays implementation or access.

| Provider     | Operation              | Implemented | Deterministic | Provider-test | Live access | External gate |
| ------------ | ---------------------- | ----------- | ------------- | ------------- | ----------- | ------------- |
| Booking.com  | search                 | adapter     | synthetic     | unverified    | unverified  | blocked       |
| Booking.com  | detail                 | missing     | unverified    | unverified    | unverified  | blocked       |
| Booking.com  | read-only revalidation | missing     | unverified    | unverified    | unverified  | blocked       |
| Booking.com  | book                   | conditional | unverified    | unverified    | unverified  | blocked       |
| Booking.com  | status                 | conditional | unverified    | unverified    | unverified  | blocked       |
| Booking.com  | idempotency            | conditional | unverified    | unverified    | unverified  | blocked       |
| Booking.com  | cancel                 | conditional | unverified    | unverified    | unverified  | blocked       |
| Booking.com  | reschedule             | conditional | unverified    | unverified    | unverified  | blocked       |
| Duffel       | search                 | adapter     | synthetic     | unverified    | unverified  | blocked       |
| Duffel       | detail                 | missing     | unverified    | unverified    | unverified  | blocked       |
| Duffel       | read-only revalidation | missing     | unverified    | unverified    | unverified  | blocked       |
| Duffel       | book                   | conditional | unverified    | unverified    | unverified  | blocked       |
| Duffel       | status                 | conditional | unverified    | unverified    | unverified  | blocked       |
| Duffel       | idempotency            | conditional | unverified    | unverified    | unverified  | blocked       |
| Duffel       | cancel                 | conditional | unverified    | unverified    | unverified  | blocked       |
| Duffel       | reschedule             | conditional | unverified    | unverified    | unverified  | blocked       |
| Trainline    | search                 | adapter     | synthetic     | unverified    | unverified  | blocked       |
| Trainline    | detail                 | missing     | unverified    | unverified    | unverified  | blocked       |
| Trainline    | read-only revalidation | missing     | unverified    | unverified    | unverified  | blocked       |
| Trainline    | book                   | conditional | unverified    | unverified    | unverified  | blocked       |
| Trainline    | status                 | conditional | unverified    | unverified    | unverified  | blocked       |
| Trainline    | idempotency            | conditional | unverified    | unverified    | unverified  | blocked       |
| Trainline    | cancel                 | conditional | unverified    | unverified    | unverified  | blocked       |
| Trainline    | reschedule             | conditional | unverified    | unverified    | unverified  | blocked       |
| GetYourGuide | search                 | adapter     | synthetic     | unverified    | unverified  | blocked       |
| GetYourGuide | detail                 | missing     | unverified    | unverified    | unverified  | blocked       |
| GetYourGuide | read-only revalidation | missing     | unverified    | unverified    | unverified  | blocked       |
| GetYourGuide | book                   | conditional | unverified    | unverified    | unverified  | blocked       |
| GetYourGuide | status                 | conditional | unverified    | unverified    | unverified  | blocked       |
| GetYourGuide | idempotency            | conditional | unverified    | unverified    | unverified  | blocked       |
| GetYourGuide | cancel                 | conditional | unverified    | unverified    | unverified  | blocked       |
| GetYourGuide | reschedule             | conditional | unverified    | unverified    | unverified  | blocked       |

## Safe implementation evidence

- Read adapters: `web/server/supply/providers/{booking,duffel,trainline,getyourguide}-read.ts`.
  Shared `adapter.ts` exposes search only. Current Booking.com attribution uses
  `booking.com`; canonical routing alias compatibility remains implementation work.
- Deterministic composition: `web/server/supply/providers/index.ts` and
  `synthetic.ts`. Live mode requires explicitly injected providers; no synthetic
  fallback establishes live success.
- Transaction wrappers: corresponding `*-transactions.ts` and
  `web/server/supply/transactions.ts`. Capabilities originate in injected clients.
  Transaction revalidation does not establish a safe read-only discovery method.
- Baseline tests: [baseline](baseline.md). Aggregate passes are not proof of each
  provider operation, wire format, idempotency, market or approved account scope.

## Historical external gates (2026-10-18)

This section records the old baseline. Only gates applicable to current-scope
products remain current requirements; do not onboard deferred/replaced providers
solely to satisfy this historical section.

For every operation, approved API contract/version, scoped secret provisioning,
access approval, verification time/reference, markets, party/property/fare
coverage, quota, deadline, rate and freshness policy remain unknown. Separate web
read secrets and worker transaction secrets are required. No agent/browser secret
access is authorized. Missing evidence blocks live activation, not deterministic
implementation or unrelated accepted-trip reads.

- Booking.com: Demand read approval and property/occupancy mappings; separate
  Orders approval, trusted prerequisites and transaction/status semantics.
- Duffel: complete offer pricing/material terms and approved Orders/payment,
  idempotency/status semantics plus trusted passenger/payment references.
- Trainline: partner documentation, credentials, market/carrier rights and explicit
  read/write/status/idempotency semantics; endpoints must not be invented.
- GetYourGuide: approved reseller Partner API reads and separate booking/status
  access; inventory Supplier API and reservation/cart operations are not MCP reads.

Update individual operation rows only with reproducible, redacted evidence.

## Current scope revision (2026-10-19)

T001-T008 remain historical; T093 corrects provider/key configuration before US1.
The table tracks product operations, not configuration-only verification.
Update operation rows only after reproducible operation-specific checks.

| Product           | Current implementation evidence                                                                                                                                                                                   | Deterministic revision acceptance                                                                                                             | Provider-test / live access                                                                                                                       | Activation gate                                                                                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duffel Flights    | T018 complete: fixed read search/current-offer/detail mappings retain fare, baggage and payment prerequisites; sourced timezone qualification; optional fees unknown; no orders/payments                          | Synthetic wire, expiry/changed-price, revision/CAS and no-write tests pass                                                                    | Supplier sandbox/live unverified                                                                                                                  | Separate read/write keys, trusted IATA mapping, approved flight operation/market/pricing semantics and unresolved service/payment costs; worker transactions remain separate                                                                                                                          |
| Duffel Stays      | T017 partial: search/room-rate detail implemented; quote implementation conditionally approved on 2026-10-21, not yet implemented or enabled                                                                      | Synthetic search/detail, occupancy mismatch, product isolation and unknown mandatory-fact tests pass; quote tests pending                     | Authorized standalone sandbox probes returned HTTP 403 for both distinct read and transaction tokens; rates/quote not run; live access unverified | Search is blocked for both tested token/access contexts; exact denial cause unconfirmed. Transaction-token diagnostic did not enable a web-read fallback. Quote-only semantics remain approved for implementation; preserve independent access gates, room allocation and pricing/payment uncertainty |
| Viator activities | T019 complete: fixed read product/options/detail/availability mappings retain party, terms, prerequisites, retail and destination extras; zero/single/multiple-option outcomes; complete customer pricing unknown | Synthetic wire, exact-decimal extras, forbidden endpoints, cancellation, shared-key boundary and persisted unknown/unavailable revisions pass | Supplier sandbox/live unverified                                                                                                                  | One trusted upstream key, approved tier/coverage, numeric destination mapping, exact day and trusted product age bands/answers; no hold/cart/booking methods                                                                                                                                          |
| Rail / Trainline  | Deferred; rail-only/mixed searches return unsupported without rail adapter calls or synthetic inventory; read/status compatibility covered by T020, restricted dispatch remains T068                              | Search deferral, saved provenance and injected legacy confirmation/status reads tested                                                        | Not a current activation target                                                                                                                   | No replacement or current onboarding requirement; required unresolved rail blocks whole-trip booking                                                                                                                                                                                                  |
| Booking.com       | Deferred; saved attribution and injected legacy confirmation/status compatibility tested by T020                                                                                                                  | Deterministic read-compatibility regressions pass; no new-write guard certification                                                           | Not a current activation target                                                                                                                   | Future feature; no new writes or current setup requirement                                                                                                                                                                                                                                            |
| GetYourGuide      | Replaced; saved attribution and injected legacy confirmation/status compatibility tested by T020                                                                                                                  | Deterministic read-compatibility regressions pass; no new-write guard certification                                                           | Not a current activation target                                                                                                                   | No fallback, relabelling or new writes                                                                                                                                                                                                                                                                |

Record support/access separately for every current provider, component type and
operation. Flights evidence cannot set Stays readiness. Viator key presence
cannot set booking entitlement. Distinct secret names do not confer distinct
upstream scopes: the same Viator reference/value is permitted in trusted
web-read/worker injection, but no supplier key reaches agent/MCP/browser.
Duffel write keys remain worker-only. Product wire tests now use synthetic
fixtures; no supplier sandbox or live provider calls were performed.

The [2026-10-20 increment](discovery.md#2026-10-20-contract-readiness-and-fixture-increment)
also verifies product-scoped detail/revalidation gating and adapter support
independent of configuration. Stays quote revalidation remains unsupported even
if configuration claims verification. Demonstration hotel/apartment/villa/hostel
fixtures are tested, not evidence of live property coverage. Unknown coverage,
rate and maximum-freshness limits remain unknown.

The [supplier wire mapping increment](discovery.md#2026-10-20-supplier-wire-mapping-increment)
completes T018/T019 implementation with documentation-grounded synthetic fixtures.
Its 152 affected web tests and 37 actual MCP tests passed without skips, along
with typecheck, targeted lint and snapshot/shared supply contract drift.
This does not verify supplier access, complete customer pricing or T017 quote
permissions; those activation gates remain closed.

### T093 configuration evidence (2026-10-19)

- Configuration/application regressions reproduced 15 failures and 6 passes,
  then passed all 21 tests after the correction. Web TypeScript and targeted
  ESLint passed. See [baseline](baseline.md) for exact commands.
- Readiness accepts only active `duffel`/`viator` IDs, separates Duffel flight
  and accommodation operations, and permits a shared Viator secret reference.
  Keys and references are absent from safe readiness output. Actual upstream
  permissions/booking entitlement remain externally unverified.
- Live injected adapters must have verified readiness for every advertised
  product. A ready flight lane cannot enable blocked Stays. Worker composition
  evaluates worker operation readiness and instantiates no planning providers.
- Provider clients, Viator's read endpoint allowlist, current deterministic
  supplier replacement, rail outcomes and agent no-rail planning are not
  implemented by this configuration increment. Existing legacy deterministic
  composition remains until T026; no current-scope discovery acceptance is
  claimed. The worker transaction registry remains empty pending T075.
- T093 remains partial: access to the environment example was denied, and the
  foundation gate fails before collection because all four isolated PostgreSQL
  test URLs are missing. No dependent story work or live provider calls ran.

### Foundation retest (2026-10-19)

The prior missing-test-URL blocker is resolved: provisioned a separate disposable
PostGIS cluster and all four synthetic test-role URLs in the test process,
without modifying the existing application database or saving credentials.
After fixing a test-helper teardown race, the foundation gate passed 43 tests
across 4 files with zero skips/unhandled errors. Typecheck and helper lint passed.
See [baseline](baseline.md) for the failed attempts and final evidence.

T093 is still partial only because the environment-example read remains
explicitly denied. No product-operation or live-access status above is promoted
by this foundation pass, and no story work/provider call was performed.

### T093 closeout (2026-10-19)

The user has now confirmed updating the environment example to the supplied
replacement. T093 is complete on that user confirmation plus executed
configuration/foundation evidence, not independent inspection of the restricted
file. The supplied JSON/blank-key example passed the actual loader smoke check;
21 focused tests, typecheck and targeted lint passed again. The clean 43-test
foundation run is recorded above. Earlier partial entries are historical.

This does not promote any product operation to implemented/tested/live-ready
status: transport mappings, restricted read allowlists, actual no-rail planning
and workflow composition remain T009-T092.

### First discovery increment (2026-10-19)

The current table includes bounded deterministic search evidence from the first
US1 increment, superseding earlier statements that default composition still
uses legacy suppliers. Search now isolates Duffel products, retains Viator
results on sibling failure, reports missing/unverified/blocked access distinctly
from no matches and rejects deferred/replaced active inventory. Rail-only and
mixed queries never invoke Trainline or a replacement. No saved records,
attribution, transaction adapters or reconciliation paths were changed.

Focused contracts/unit tests: 53 passed; disposable PostGIS foundation: 43
passed. The affected consumer run passed 76 tests and exposed one guest-setup
failure before supplier research (`departureOrigins` absent on the initial
snapshot). The final 11-file focused consumer subset passed 73 tests without
skips after adding explicit current-provider/no-rail refinement assertions;
the independent guest-setup failure remains open. Full US1 acceptance is not
claimed. See [baseline](baseline.md).
No key was read, supplier API called, provider entitlement verified or
transaction performed. In particular, an injected-client factory is not a
Viator endpoint allowlist, a Duffel Stays quote mapper or live-access evidence.

### Four-step discovery implementation

The current table supersedes earlier missing-transport/MCP/UI statements.
Implemented nullable canonical discovery facts, immutable scoped references,
browser/internal read routes, four actual FastMCP tools, current-version
workspace comparisons and real fixed-host read HTTP mappings. See
[discovery evidence](discovery.md) for commands, positive/negative tests and
limitations. Transport tests establish code behavior only, not supplier
approval. No Stays quote or transaction operation was added, and no key was
read or used.

## T017 conditional implementation approval (2026-10-21)

**Decision**: Approve implementing and deterministically testing the documented
Stays quote flow. The user reports Duffel confirmed that quote creation has no
side effects or obligations beyond a quote record and authorizes trying the
existing separate read token for search, all-rates and quotes. This is a
user-supplied confirmation, not an independently authenticated support record.
It closes the no-hold design question for implementation; it does not certify
read-token permission, account entitlement, implementation completion or live
access. T017 stays unchecked until its code and required tests are complete.

### Sources checked directly

| Source                                                                                                                                                                                                                        | Established fact and limit                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Stays integration guide](https://duffel.com/docs/guides/getting-started-with-stays)                                                                                                                                          | Search, all-rates, quote and booking are separate steps. Stays access must be requested. Quote creation checks a selected rate before charging/booking; availability can change before purchase.                                                      |
| [Flight holding guide](https://duffel.com/docs/guides/holding-orders-and-paying-later)                                                                                                                                        | Holding a flight requires creating an air order with hold semantics. This is not Stays quote documentation and does not independently establish Stays behavior. Air orders remain forbidden in research.                                              |
| [Create/get quote and schema](https://duffel.com/docs/api/v2/quotes/create-quote)                                                                                                                                             | `POST /stays/quotes` takes `rate_id`; `GET /stays/quotes/{id}` retrieves an existing quote. The create operation confirms availability and total pricing; retrieval is not documented as a fresh availability/price check.                            |
| [All room rates](https://duffel.com/docs/api/v2/search-result/fetch-all-rates) and [search](https://duffel.com/docs/api/v2/search/stays-search)                                                                               | Search returns cheapest-rate information but incomplete room/rate details; the all-rates action supplies complete room/rate information for a saved search result.                                                                                    |
| [Authentication](https://duffel.com/docs/api/overview/making-requests) and [test mode](https://duffel.com/docs/api/overview/test-mode)                                                                                        | Tokens can be read-only or read-write. Test and live tokens access separate resource sets through the same API mechanism. These pages do not specify permission for each of the three Stays POST operations or prove this account's access.           |
| [API rate-limit article](https://help.duffel.com/hc/en-gb/articles/10229200096786-What-is-the-API-rate-limit) ([official JSON representation](https://help.duffel.com/api/v2/help_center/en-gb/articles/10229200096786.json)) | Default live **search** limit is 10 requests per 60 seconds. Limits vary by endpoint; response `ratelimit-limit` and `ratelimit-reset` describe the applicable ceiling/window. Do not apply that default to every endpoint or assume a sandbox quota. |
| [Response handling](https://duffel.com/docs/api/overview/response-handling)                                                                                                                                                   | HTTP 403 / `insufficient_permissions` means the supplied token lacks permission; 429 / `rate_limit_error` is not an inventory outcome.                                                                                                                |

The rate-limit article's HTML returned 403, but its official public JSON
representation was retrieved successfully (article updated 2026-09-08).
API reference details were read from the documentation page's structured
`resource.model` and `resource.operations`, not inferred from sample payloads
or search summaries. No public source checked explicitly guarantees a
read-only token can execute these POST operations. HTTP POST alone proves
neither a booking side effect nor a required token permission.

### Mapping and eligibility requirements approved for T017

| Concern                     | Documented mapping and required behavior                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and selection      | Preserve search result `srr_...`, accommodation `acc_...`, chosen rate `rat_...` and returned quote `quo_...`. Create a quote only from a selected rate granted by the same saved search/query; validate that the returned nested rate belongs to that selection. The room schema has name/beds/photos/rates, but no room ID: retain sourced room association, never manufacture a supplier room ID.                                                                                  |
| Occupancy and dates         | Quote `rooms` is the room count, not a room array. `guests`, `check_in_date` and `check_out_date` carry party/service facts; missing guests remain unknown. Guest child age is documented at booking time, not inferred from service-date age or `ageAtTripStart`; unresolved trusted age/room allocation cannot become verified eligibility.                                                                                                                                         |
| Expiry and freshness        | Search-result `expires_at` and selected nested rate `expires_at` are documented. The inspected quote schema has no top-level quote `expires_at` or separate promised quote lifetime. Preserve sourced expiries with their meaning, use the selected rate expiry conservatively and never invent a quote TTL or extend expiry locally. A GET of an existing quote alone cannot establish fresh revalidation.                                                                           |
| Mandatory price breakdown   | Preserve root quote `base_amount`, `tax_amount`, `fee_amount`, `total_amount` and their currencies using exact integer minor units. Base/tax/fee components are already included in the rate total; do not add them to the total again. Nullable or missing amounts remain unknown, not zero. Keep supplier economics out of public projections.                                                                                                                                      |
| Due at accommodation        | `due_at_accommodation_amount` is mandatory tax/fees not included in `total_amount` and not collected during booking. It can be payable at check-in or check-out and its currency can differ from `total_currency`. Preserve the separate amount/currency; do not silently convert, omit it or claim it is charged now. Unknown mandatory amounts or unsupported currency handling block booking.                                                                                      |
| Deposit                     | Root `deposit_amount` is a portion of `total_amount` payable before check-in, not an extra charge. It can be null even for a deposit rate; rate conditions may then contain the missing details. Null is not a zero-deposit or no-deposit guarantee. An unresolved amount or payment schedule blocks booking.                                                                                                                                                                         |
| Payment timing              | Selected rate `payment_type` is `pay_now`, `deposit` or `guarantee`; retain `available_payment_methods`. `pay_now` can mean at booking or before check-in, not necessarily an exact immediate charge. Deposit rates prepay part and settle the remainder at the property. Guarantee rates require a card and may incur accommodation/no-show charges. Do not fabricate payment dates, infer authorization, or collect card details in research. Unsupported schedules remain blocked. |
| Conditions and cancellation | Preserve bounded, privacy-safe mandatory `conditions` and `cancellation_timeline` (cutoff/refund evidence); do not infer refundability from payment type. Raw rate descriptions are not a safe direct customer-display contract.                                                                                                                                                                                                                                                      |

### Permission probe and activation

- Approved probe: use only the already provisioned separate Duffel read
  credential and a test-mode token, fixed API v2 host, synthetic party and a
  trusted Stays location. Execute one search, one all-rates request for a returned
  search result, then one quote for an explicitly selected returned rate. No
  booking, order, hold, payment or automatic rate-selection operation is allowed.
- Never promote the transaction token into web reads or change secret
  references/scopes to make a failed probe succeed. HTTP 401/403 blocks that
  operation, not unrelated products. Record permission results separately per
  operation and test/live environment. Sandbox success cannot verify live access.
- Respect the actual endpoint headers and safe rate-limit guidance. The
  documented 60-second search window is not permission to wait beyond the
  existing eight-second supplier/twelve-second overall budgets. If guidance
  cannot be validated or does not fit, surface rate limiting without retry.
  The existing generic `Retry-After` handling alone does not certify Duffel's
  `ratelimit-*` header integration or production quota enforcement.
- Probe attempted here only as a prerequisite availability check:
  `SUPPLIER_PROVIDERS` is absent in this runner process. No read credential was
  available or inspected; no authenticated supplier API request was sent. No
  environment file, account resource, traveller/payment data or secret was read.
  The permission probe therefore remains **not run**, not failed or verified.
- The user's statement that Stays uses the same sandbox/production permission
  model and keys is recorded as the same authentication mechanism, not
  interchangeable test/live tokens, shared read/write credentials or inherited
  Flights-to-Stays entitlement. Existing separate-key boundaries remain intact.

**Current result**: T017 is approved to implement with the above constraints;
quote support in the running code remains unsupported until implemented and
tested. Read-key permission and sandbox/live activation remain unverified.

### Authorized sandbox read-token probe (2026-10-21)

This later executed check supersedes the earlier approval-time statement that
no credential was available. The user explicitly authorized using `.env` and
confirmed that the supplied read token is sandbox and read-only. The probe
loaded that authorized file privately and independently checked the read
token's `duffel_test_` prefix. It selected and transmitted only
`DUFFEL_READ_SECRET`; the transaction token was not selected or transmitted.
The upstream token scope was user-confirmed, not independently inspected in
the Duffel dashboard.

Inputs were synthetic: two adults, one room, London city-centre coordinates,
2026-11-20 through 2026-11-22. Requests used the fixed Duffel host, API v2,
no redirects, an eight-second deadline and no automatic retries. There were
three authenticated search attempts: the initial broad-radius attempt produced
a sanitized payload/transport failure without a retained HTTP status; two
subsequent narrowly bounded diagnostic attempts returned HTTP 403. A separate
unauthenticated control checked endpoint reachability without loading secrets.
No inventory selection, rate request, quote, hold, booking, payment or order
was performed.

| Check                                                         | Observed result                                                                                       | Safe request reference |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| `POST /stays/search` with the sandbox read token, 1-km radius | HTTP 403; body was not valid JSON, so no documented Duffel error type/code could be extracted         | `GOB7NajSct5CC14AAa8I` |
| Same authenticated search, bounded denial classification      | HTTP 403 again; no structured `insufficient_permissions` code established                             | `GOB7P0ghXRxd1ccAA5yF` |
| Same search endpoint without an Authorization header          | HTTP 401 with a JSON response; the endpoint is reachable and responds differently without credentials | `GOB7RoaINKEZz3YABAWE` |
| Fetch all rates                                               | Not run: no granted search result was returned                                                        | None                   |
| Create/get quote                                              | Not run: no granted rate/quote was available                                                          | None                   |

The two authenticated responses reported `ratelimit-limit: 30`; the final
authenticated `ratelimit-reset` value was
`Wed, 21 Oct 2026 07:37:00 GMT`. These are observed sandbox response headers,
not a claim that every sandbox endpoint has a 30-request quota or that live
search's documented default changed. Neither response was a 429.

**Conclusion**: Search is denied for this sandbox token/access context.
HTTP 403 alone, especially without a structured error code, does not establish
whether the precise cause is read-only scope, Stays entitlement, account
configuration or another access policy. No general claim about all read-only
tokens is justified. Rates and quote permissions are still untested, not
rejected or approved by inference.

Keep this product's activation blocked. Ask Duffel to diagnose the authenticated
request references and confirm whether this separately scoped read-only token
is permitted to execute each of search/all-rates/quote. Do not retry with a
transaction token or mark configured operation access verified from this run.
Conditional T017 implementation approval remains valid; task completion and
sandbox/live activation do not follow from it.

Only safe status/category/header/request-reference results were emitted.
Credentials and raw responses were neither printed nor saved; no environment
file, runtime configuration or read-operation capability was changed.

### Explicit transaction-token diagnostic (2026-10-21)

After the read-token denial, the user explicitly requested testing
`DUFFEL_TRANSACTION_SECRET`, stating POST requests require that token. This
authorized a standalone sandbox diagnostic only, not a configuration change or
automatic privileged fallback in web reads. The diagnostic's closed endpoint
allowlist contained only Stays search, all-rates and quote creation. No booking,
hold, air order or payment endpoint was allowed.

Privately loaded the authorized `.env` and checked both token prefixes and
inequality without printing, hashing or saving either token. Both use the
sandbox prefix and they are distinct. Neither variable preexisted in the
runner environment, so the tested values came from the authorized file, not
inherited process overrides. The transaction token's actual upstream permission
set was not independently inspected.

One authenticated search request used the transaction token, the same synthetic
two-adult/one-room London fixture and 2026-11-20 to 2026-11-22 dates, API v2,
1-km radius, no redirects and an eight-second deadline.

| Check                                               | Observed result                                                            | Safe request reference |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| `POST /stays/search` with sandbox transaction token | HTTP 403; non-JSON response, no structured provider error code established | `GOB7hZJSg3E97nMACLuE` |
| Fetch all rates                                     | Not run: no granted search result                                          | None                   |
| Create quote                                        | Not run: no granted rate                                                   | None                   |

Response headers again reported `ratelimit-limit: 30` and
`ratelimit-reset: Wed, 21 Oct 2026 07:42:00 GMT`; this was not a 429.
There was no automatic retry. No resource IDs, supplier prices, credential
values or raw response body were emitted or persisted.

**Conclusion**: Selecting the distinct transaction token did not resolve the
Stays search denial. Both tested tokens receive 403 while the earlier
unauthenticated control receives 401. These observations do not establish a
general rule that all POSTs require transaction tokens, nor prove whether the
remaining issue is Stays entitlement, token permissions, account configuration
or another access policy. Ask Duffel to investigate transaction-token request
`GOB7hZJSg3E97nMACLuE` alongside the read-token references above.

Stays activation remains blocked; all-rates and quote permissions are still
untested. Conditional implementation approval is unchanged and T017 remains
incomplete. No application secret references, operation readiness, environment
files or runtime code were changed.
