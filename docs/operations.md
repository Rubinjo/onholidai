# Operations guide

## Services and startup order

Use Node.js 24, pnpm 12, Python 3.13/uv, and Docker Compose v2. Provision distinct 32-character secrets for the web auth, service token, and pricing diagnostics. Never share the pricing diagnostic key with the agent or browser. For local-only runs, `.env.example` contains synthetic defaults; production startup rejects synthetic auth and service secrets. Database-backed tests use isolated databases created from `TEST_DATABASE_ADMIN_URL`/`TEST_DATABASE_MIGRATION_URL`/`TEST_DATABASE_APP_URL`/`TEST_DATABASE_WORKER_URL` (provision the roles with `infra/postgres/test-roles.sql`); without them those suites skip. On Windows, set `PYTEST_DEBUG_TEMPROOT` to an apostrophe-free directory when the user profile path breaks pytest's default temp root.

Start `--profile infrastructure` for PostgreSQL 18/PostGIS, Temporal, and local observability. Apply schema migrations through the dedicated migration role using `--profile infrastructure --profile migrations`; migrations 001–014 are ordered and checksum-verified. Migration 014 adds read-only research runs and immutable offer revisions without changing accepted-trip storage. The `migrate` job depends on `postgres`, and Compose only resolves a `depends_on` target inside a profile enabled for that invocation, so the migration command must name `infrastructure` too. Start `--profile applications` afterward. Start `--profile booking` only when the TypeScript Temporal worker is required. Do not run a second migration process concurrently.

### Disposable foundation database tests (PowerShell)

Run from the repository root with Docker's Linux engine available. This uses
only synthetic credentials and a new, uniquely named PostGIS container, not the
application database or its secrets. The loopback host port is allocated by
Docker; each test creates its own database using the existing isolated-role
helper. The foundation command requires all four URLs and does not silently skip
when they are missing. The test helper waits for server-confirmed client closure
before dropping fixture databases and reports leaked connections explicitly.

```powershell
$testContainer = "onholidai-foundation-$([guid]::NewGuid().ToString('N'))"
$testUrlNames = @(
  'TEST_DATABASE_ADMIN_URL', 'TEST_DATABASE_MIGRATION_URL',
  'TEST_DATABASE_APP_URL', 'TEST_DATABASE_WORKER_URL'
)
$previousUrls = @{}
foreach ($name in $testUrlNames) {
  $previousUrls[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$created = $false
try {
  docker run --detach --name $testContainer --publish 127.0.0.1::5432 `
    --env POSTGRES_DB=postgres --env POSTGRES_USER=postgres `
    --env POSTGRES_PASSWORD=synthetic-foundation-admin `
    --tmpfs /var/lib/postgresql:rw postgis/postgis:18-3.6
  if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated test PostgreSQL' }
  $created = $true
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker exec $testContainer pg_isready -h 127.0.0.1 -U postgres -d postgres
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'Isolated test PostgreSQL did not become ready' }
  Get-Content -LiteralPath .\infra\postgres\test-roles.sql -Raw |
    docker exec -i $testContainer psql -U postgres -d postgres --set ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Could not provision synthetic test roles' }
  $binding = docker port $testContainer 5432/tcp
  if ($LASTEXITCODE -ne 0) { throw 'Could not resolve test database port' }
  $portNumber = ($binding.Trim() -split ':')[-1]
  $env:TEST_DATABASE_ADMIN_URL = "postgresql://postgres:synthetic-foundation-admin@127.0.0.1:${portNumber}/postgres"
  $env:TEST_DATABASE_MIGRATION_URL = "postgresql://onholidai_migration:synthetic-migration@127.0.0.1:${portNumber}/postgres"
  $env:TEST_DATABASE_APP_URL = "postgresql://onholidai_web:synthetic-web@127.0.0.1:${portNumber}/postgres"
  $env:TEST_DATABASE_WORKER_URL = "postgresql://onholidai_worker:synthetic-worker@127.0.0.1:${portNumber}/postgres"
  corepack.cmd pnpm --dir web test:foundation
  if ($LASTEXITCODE -ne 0) { throw 'Foundation tests failed; inspect runner output' }
} finally {
  foreach ($name in $testUrlNames) {
    [Environment]::SetEnvironmentVariable($name, $previousUrls[$name], 'Process')
  }
  if ($created) {
    docker stop $testContainer
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop isolated test PostgreSQL' }
    docker rm $testContainer
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove isolated test PostgreSQL' }
  }
}
```

## Provider capabilities

Deterministic doubles are the default. Current search composition is Duffel Flights/Stays and Viator activities; Booking.com and Trainline are deferred, and GetYourGuide is replaced. Rail-only and mixed searches return an explicit unsupported/deferred rail outcome, without invoking rail adapters or substituting inventory. Supported mixed-query results are retained. Read-only HTTP transports, revisioned evidence, the four-tool in-memory MCP facade and the workspace comparison panel are implemented and tested with synthetic fixtures. This is discovery, not completion of [feature 003](../specs/003-supplier-mcp-booking/tasks.md) or verified supplier access. Existing saved provider identities and confirmations must not be relabelled.

Search results distinguish available inventory, successful no-matches, unconfigured/blocked access, unsupported coverage, rate limiting, deadlines and errors per provider/product. Source mode is explicit (`deterministic`, `live` or `unknown` for an undeclared injected client). The internal search route supplies product readiness and request cancellation; configured-but-unverified live access does not execute. Reads have an eight-second source ceiling, propagate abort, and deduplicate before fairly allocating up to 32 offers across products and requirement/selection groups. There are no default retries: only a trusted `SupplyReadError` with a bounded rate-limit delay can trigger one read retry, and only when that delay fits the original source deadline. The retry does not reset that deadline, and cancellation stops the wait without another supplier call. Arbitrary exception messages/payloads never become public retry guidance or error text. Search and evidence refresh enforce a twelve-second overall budget at access/persistence boundaries; cancelled or expired work cannot append evidence. Refresh rejects a known-stale revision before a supplier call and rechecks the latest revision under the source-run lock before appending, so concurrent refreshes cannot overwrite immutable evidence.

Live provider use requires separately provisioned credentials, commercial access, rate limits, and confirmation of the account's permitted operations. Availability, status lookup, idempotent writes, cancellation, and rescheduling are capability-specific; consult [supply contracts](../contracts/supply/README.md) and check the deployed adapter configuration before enabling an operation. An adapter declaration does not guarantee inventory or commercial access. Unknown outcomes stay `unknown` until reconciled; never retry an ambiguous provider write with a new key.

### Research evidence and live read prerequisites

The workspace's **Find supplier options** action starts an ordinary
`supplier_research` run. Only `supplier_search`, `supplier_offer_details`,
`supplier_revalidate_offer` and `supplier_capabilities` are registered in its
in-memory MCP server. Owner/trip/run/version/token context is captured by the
server, not supplied by tool arguments. Signed callbacks use the web audience
and `trip:read` scope. No proposal scope or supplier secret reaches this facade.

Search evidence is separate from accepted components. Missing dates, terms,
details, totals, taxes and fees remain unknown; complete strict materialization
is required before an offer can enter a trip proposal. Details and revalidation
append immutable revisions with compare-and-swap. An unknown/failed read cannot
extend old evidence or grant booking authority. The browser may inspect its
current-version completed research; internal callbacks additionally require an
active, unrevoked grant for the same run. Source access and ownership are
rechecked after in-flight reads. All responses are private/no-store.

Capability responses distinguish the adapter's implemented read operations from
configured product access. Configuration cannot enable an unsupported operation:
Duffel Stays quote revalidation remains unsupported even with a verified
configuration declaration. Detail/revalidation check their own product's support
and access, including Viator independently of Duffel. Blocked or unverified reads
preserve prior evidence without appending a revision. Coverage, property types,
rate limits and maximum freshness remain unknown where not established; query
and deadline ceilings are reported separately. Demonstration property variants
are synthetic fixtures, not evidence of live property coverage or age eligibility.

The web composition root resolves only configured read-secret references.
Duffel write keys are never used as a read fallback. Viator's shared upstream
key is constrained by fixed read endpoint/method allowlists, not by its name.
`VIATOR_ENVIRONMENT` accepts `sandbox` (the default) or `production`; change it
only when deploying approved production access. Duffel test/live behavior is
determined by the injected read token, using its fixed API host.

Trusted supplier-location mappings are prerequisites, not invented from names
or internal destination UUIDs. Default Flights and Viator resolvers read
respectively `providerPlaceIds["duffel:flight"]` (IATA) and
`providerPlaceIds["viator:destination"]` (numeric supplier destination ID) from
the authoritative saved trip. Missing mappings return unsupported coverage.
Trusted deployments may inject `supplierMappings` at `createApplication`.
Stays additionally requires separately verified access and an explicit trusted
coordinate/radius/room allocation resolver; room counts are not inferred.
Viator availability requires an exact day and trusted product age-band mapping;
`ageAtTripStart` alone does not establish service-date eligibility.

Stays quote/revalidation remains unsupported in the current code. On
2026-10-21 the user supplied quote-only side-effect confirmation and approved
implementing T017 plus a bounded sandbox probe with the existing separate read
token. This is not verified read-token permission or live activation; see the
[approval evidence](../specs/003-supplier-mcp-booking/evidence/provider-readiness.md#t017-conditional-implementation-approval-2026-10-21).
Do not substitute a transaction token after a permission failure. Duffel's
documented default live search limit is 10 requests per 60 seconds, not a
universal endpoint/sandbox quota; respect actual endpoint limit/reset headers
within existing read deadlines.
The subsequently authorized sandbox probe returned HTTP 403 for search with
the user-confirmed read-only token; an unauthenticated control returned 401.
The denial was not structured JSON, so scope versus Stays/account access is
not established. Rates/quotes could not be tested without a search result.
See the [executed probe and support request references](../specs/003-supplier-mcp-booking/evidence/provider-readiness.md#authorized-sandbox-read-token-probe-2026-10-21).
Keep Stays access blocked; sandbox response headers reported a ceiling of 30,
which is not a verified quota for other operations or environments.
A later standalone transaction-token diagnostic, explicitly authorized by the
user, also returned HTTP 403 for search. The two sandbox tokens were privately
confirmed distinct, so selecting the transaction token did not resolve access.
The [transaction-token evidence](../specs/003-supplier-mcp-booking/evidence/provider-readiness.md#explicit-transaction-token-diagnostic-2026-10-21)
records the safe support reference. This did not change web credential
composition or establish a rule about permissions for every POST operation.
Search's cheapest rate is not a complete quote.
Sourced Stays room count and guest evidence must match the trusted request;
missing occupancy, room identity, property type or quote deposit facts stay
unknown. Rate payment methods, mandatory conditions and refund timelines are
retained, but cannot establish a quote or permission to book.
For the approved quote mapping, use sourced selected-rate expiry rather than
inventing a quote TTL or supplier room ID. Taxes/fees are already included in
the rate total, deposits are portions of it, and mandatory due-at-property
charges are separate and can use another currency. Null amounts, unresolved
occupancy and unsupported payment timing/currencies still block booking.

Duffel flight fare, baggage, payment deadlines and identity/service prerequisites
are retained without passenger IDs or payment identifiers. Offset-free service
times are qualified only when the source airport supplies a valid timezone
and the local instant is unambiguous; missing zones and DST gaps/overlaps stay
unknown. Base/tax reconciliation does not prove optional service or payment
fees are zero, so complete customer totals remain unknown without those facts.

Viator product content alone has unknown availability. An exact-day check with
no available options is unavailable; multiple available options are retained
without silently selecting one. Booking-question counts are prerequisite
evidence, not verified answers. Sourced recommended retail, mandatory destination
extras and retail inclusive of extras are separate facts: inclusive retail
already contains those extras and must not have them added again. Taxability
flags do not establish tax amounts, collection responsibility or an approved
complete customer total. Absent mandatory amounts remain unknown. Saved reads
and immutable refresh revisions preserve source unknown/unavailable evidence
without modifying accepted trip state.

Safe supplier-fact summaries have a 2,000-character limit; oversized mappings
return unsupported rather than silently truncating material terms.
Unsupported property filters affect accommodation only, not flight/activity
results; requirement-ID selection remains unsupported. Client instances retain
bounded same-query native-ID read grants; after a restart, repeat search before
requesting source details. No credential, sandbox call or transaction is needed
for the deterministic suite. See [discovery evidence](../specs/003-supplier-mcp-booking/evidence/discovery.md)
for executed checks and the separate unverified gates.

### Supplier readiness configuration

`SUPPLIER_PROVIDERS` is JSON containing only optional `duffel` and `viator` entries. Remove old Booking.com/Trainline/GetYourGuide entries from current configuration; their presence is a validation error, not an activation request. This does not migrate or delete historical trip/booking data.

Each entry has `readSecretRef`, `transactionSecretRef` and `products`. References name separately provisioned environment secrets, not literal API keys. Duffel supports `products.flight` and `products.accommodation`; Viator supports `products.activity`. Each product has an `operations` map for `search`, `detail`, `revalidation`, `book`, `status`, `idempotency`, `cancel` and `reschedule`. Each operation records `support` (`supported`, `unsupported`, `unknown`), `access` (`unconfigured`, `configured_unverified`, `verified`, `blocked`), and optional approved `evidenceRef` / ISO `verifiedAt`. Missing facts remain unknown; key presence alone never verifies an operation or Viator booking entitlement.

For example, this intentionally unverified configuration uses one upstream Viator key, not two separately scoped Viator keys:

```json
{
  "duffel": {
    "readSecretRef": "DUFFEL_READ_SECRET",
    "transactionSecretRef": "DUFFEL_WRITE_SECRET",
    "products": {
      "flight": {
        "operations": { "search": { "support": "supported", "access": "configured_unverified" } }
      },
      "accommodation": {
        "operations": { "search": { "support": "unknown", "access": "unconfigured" } }
      }
    }
  },
  "viator": {
    "readSecretRef": "VIATOR_SECRET",
    "transactionSecretRef": "VIATOR_SECRET",
    "products": {
      "activity": {
        "operations": { "search": { "support": "supported", "access": "configured_unverified" } }
      }
    }
  }
}
```

Provision Duffel's distinct read and write keys only in web and worker respectively. Identical references are rejected, as are identical nonempty key values when both are supplied to one process. Distinct references cannot prove upstream scope: verify actual Duffel permissions separately. The same Viator secret reference/value may be provisioned in trusted web-read and worker processes; the planned read client's closed non-transactional endpoint allowlist is still required before live activation. No supplier key belongs in Python, MCP, browser configuration, logs or workflow history.

Web composition evaluates read readiness and excludes restricted writes. Worker composition evaluates restricted operation readiness and creates no planning providers. Live injected search adapters must have verified readiness for every product they advertise; one verified Duffel product cannot authorize another. Deterministic mode never reports live verification. The legacy provider-level `operations` map remains a compatibility input only for Duffel Flights (never Stays) or Viator activity; an explicit product declaration takes precedence without inheriting omitted operation evidence.

On 2026-10-19 the user confirmed updating the environment example to the supplied Duffel/Viator replacement. Its supplier JSON with blank keys was validated through the configuration loader; the saved file was not independently inspected because tool access remains denied. The foundation suite also passed all 43 tests without skips or unhandled errors. See [implementation evidence](../specs/003-supplier-mcp-booking/evidence/baseline.md) for exact verification and remaining story work. No live supplier calls or bookings are enabled by this example.

## Booking recovery

Check the booking's durable transaction and component status before taking action. For `unknown`, use the provider status query or authenticated callback reconciliation. Keep confirmed components and their provider references. A retry is permitted only after a definitive failure and fresh validation of the immutable authorization basis. Cancellation and rescheduling are separate provider actions requiring exact-term authorization. Do not infer authorization from chat or restart writes after a browser reconnect.

## Pricing policy

Customer projections use integer minor units and show the final customer amount, payable taxes/fees, estimate/live state, and freshness disclosures. Supplier amounts and platform margin are internal diagnostics, available only through the role-restricted web path. The pricing diagnostic secret is independent of service credentials. Jurisdiction-specific disclosure rules are not inferred by the application and must be supplied and approved by the business before live operation.

## Retention and deletion

Raw conversation messages expire 90 days after creation. History/context reads scrub expired message bodies in bounded batches, and expired messages are omitted from exports. Schedule `expireRawConversationMessages` daily using the web database role so inactive trips are cleaned even when their owners do not return. Trip, booking, authorization, and audit evidence enters a review after 24 calendar months without trip activity. This review does not itself delete records: immutable trip versions and transaction evidence remain preserved unless a configured business policy approves a precise deletion scope. No default deletion policy is provided.

An administrator may place or release a trip legal hold; each action is recorded in immutable audit evidence. Owners can request a scoped export; internal roles cannot request raw conversation export. Before authorizing deletion, confirm legal hold status and retain required transaction evidence. Record the configured policy ID and decision reason. Applicable privacy law, retention periods, and export requirements must be confirmed by the responsible legal/business owner.

## Health and evidence

`/api/health` and the agent `/health` endpoint check shell readiness. Database-dependent routes additionally require the schema migrations. Keep synthetic and live-provider acceptance reports separate. The release acceptance and cross-cutting evidence files list measurements that still require execution; do not treat local code review as provider, performance, or accessibility acceptance.
