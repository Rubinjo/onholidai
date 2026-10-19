# Provider implementation and access evidence ledger

Date: 2026-10-18. Contract: [provider-readiness](../contracts/provider-readiness.md).

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

| Provider | Operation | Implemented | Deterministic | Provider-test | Live access | External gate |
| --- | --- | --- | --- | --- | --- | --- |
| Booking.com | search | adapter | synthetic | unverified | unverified | blocked |
| Booking.com | detail | missing | unverified | unverified | unverified | blocked |
| Booking.com | read-only revalidation | missing | unverified | unverified | unverified | blocked |
| Booking.com | book | conditional | unverified | unverified | unverified | blocked |
| Booking.com | status | conditional | unverified | unverified | unverified | blocked |
| Booking.com | idempotency | conditional | unverified | unverified | unverified | blocked |
| Booking.com | cancel | conditional | unverified | unverified | unverified | blocked |
| Booking.com | reschedule | conditional | unverified | unverified | unverified | blocked |
| Duffel | search | adapter | synthetic | unverified | unverified | blocked |
| Duffel | detail | missing | unverified | unverified | unverified | blocked |
| Duffel | read-only revalidation | missing | unverified | unverified | unverified | blocked |
| Duffel | book | conditional | unverified | unverified | unverified | blocked |
| Duffel | status | conditional | unverified | unverified | unverified | blocked |
| Duffel | idempotency | conditional | unverified | unverified | unverified | blocked |
| Duffel | cancel | conditional | unverified | unverified | unverified | blocked |
| Duffel | reschedule | conditional | unverified | unverified | unverified | blocked |
| Trainline | search | adapter | synthetic | unverified | unverified | blocked |
| Trainline | detail | missing | unverified | unverified | unverified | blocked |
| Trainline | read-only revalidation | missing | unverified | unverified | unverified | blocked |
| Trainline | book | conditional | unverified | unverified | unverified | blocked |
| Trainline | status | conditional | unverified | unverified | unverified | blocked |
| Trainline | idempotency | conditional | unverified | unverified | unverified | blocked |
| Trainline | cancel | conditional | unverified | unverified | unverified | blocked |
| Trainline | reschedule | conditional | unverified | unverified | unverified | blocked |
| GetYourGuide | search | adapter | synthetic | unverified | unverified | blocked |
| GetYourGuide | detail | missing | unverified | unverified | unverified | blocked |
| GetYourGuide | read-only revalidation | missing | unverified | unverified | unverified | blocked |
| GetYourGuide | book | conditional | unverified | unverified | unverified | blocked |
| GetYourGuide | status | conditional | unverified | unverified | unverified | blocked |
| GetYourGuide | idempotency | conditional | unverified | unverified | unverified | blocked |
| GetYourGuide | cancel | conditional | unverified | unverified | unverified | blocked |
| GetYourGuide | reschedule | conditional | unverified | unverified | unverified | blocked |

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

| Product | Current implementation evidence | Deterministic revision acceptance | Provider-test / live access | Activation gate |
| --- | --- | --- | --- | --- |
| Duffel Flights | Fixed read HTTP search/current-offer mappings; normalized detail/revalidation; no orders/payments | Synthetic wire, revision/CAS and no-write tests pass | Supplier sandbox/live unverified | Separate read/write keys, trusted IATA mapping, approved flight operation/market/pricing semantics; worker transactions remain separate |
| Duffel Stays | Fixed read HTTP search/room-rate detail; quote/revalidation deliberately unsupported | Synthetic wire, product isolation and unknown mandatory-fact tests pass | Supplier sandbox/live unverified | Independent Stays approval, trusted coordinates/room allocation and approved no-hold/read-key quote semantics; cheapest rate is not a complete quote |
| Viator activities | Fixed read endpoint/method allowlist for product search/detail and bounded availability; complete customer pricing unknown | Synthetic wire, forbidden endpoints, cancellation and shared-key boundary tests pass | Supplier sandbox/live unverified | One trusted upstream key, approved tier/coverage, numeric destination mapping, exact day and trusted product age bands; no hold/cart/booking methods |
| Rail / Trainline | Deferred; rail-only/mixed searches return unsupported without rail adapter calls or synthetic inventory; broader compatibility remains T020/T068 | Search deferral and supported-result preservation tested | Not a current activation target | No replacement or current onboarding requirement; required unresolved rail blocks whole-trip booking |
| Booking.com | Deferred; historical data/status compatibility only | Unverified for revised scope | Not a current activation target | Future feature; no new writes or current setup requirement |
| GetYourGuide | Replaced; historical data/status compatibility only | Unverified for revised scope | Not a current activation target | No fallback, relabelling or new writes |

Record support/access separately for every current provider, component type and
operation. Flights evidence cannot set Stays readiness. Viator key presence
cannot set booking entitlement. Distinct secret names do not confer distinct
upstream scopes: the same Viator reference/value is permitted in trusted
web-read/worker injection, but no supplier key reaches agent/MCP/browser.
Duffel write keys remain worker-only. Product wire tests now use synthetic
fixtures; no supplier sandbox or live provider calls were performed.

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