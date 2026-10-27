# Operations guide

## Services and startup order

Use Node.js 24, pnpm 12, Python 3.13/uv, and Docker Compose v2. Provision distinct 32-character secrets for the web auth, service token, and pricing diagnostics. Never share the pricing diagnostic key with the agent or browser. For local-only runs, `.env.example` contains synthetic defaults; production startup rejects synthetic auth and service secrets. Database-backed tests use isolated databases created from `TEST_DATABASE_ADMIN_URL`/`TEST_DATABASE_MIGRATION_URL`/`TEST_DATABASE_APP_URL`/`TEST_DATABASE_WORKER_URL` (provision the roles with `infra/postgres/test-roles.sql`); without them those suites skip. On Windows, set `PYTEST_DEBUG_TEMPROOT` to an apostrophe-free directory when the user profile path breaks pytest's default temp root.

Start `--profile infrastructure` for PostgreSQL 18/PostGIS, Temporal, and local observability. Apply schema migrations through the dedicated migration role using `--profile infrastructure --profile migrations`; migrations 001–014 are ordered and checksum-verified. Migration 014 adds read-only research runs and immutable offer revisions without changing accepted-trip storage. The `migrate` job depends on `postgres`, and Compose only resolves a `depends_on` target inside a profile enabled for that invocation, so the migration command must name `infrastructure` too. Start `--profile applications` afterward. Start `--profile booking` only when the TypeScript Temporal worker is required. Do not run a second migration process concurrently.

The booking worker has its own composition root and configuration validation. Production requires explicit `DATABASE_URL` and `TEMPORAL_ADDRESS`; supplier configuration retains the same validation and worker-only readiness rules. It does not initialize web authentication or planning clients and does not require `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SERVICE_TOKEN_SECRET`, or `PRICING_DIAGNOSTIC_SECRET`. Keep those web/service secrets out of the worker; Compose mounts only `worker_db_password` for its database role. Web production startup still requires all of its auth and signing settings. After updating worker code, rebuild and recreate it with `docker compose -f infra/compose/compose.yml --profile infrastructure --profile booking up -d --build booking-worker`.

The hosted deployment on the Leaseweb VPS uses a separate Compose project, reverse proxy and release process; see [the production runbook](../infra/production/README.md). It does not enable the Compose `infrastructure` profile's observability services.

### Docker research mode and retry diagnostics

Run Compose from the repository root with `--env-file .env` explicitly.
The file supplies interpolation values; it is not injected wholesale into every
container. Web and agent now use `PROVIDER_MODE` (default `deterministic`) rather
than overriding it with a hard-coded mode. Compose still uses mounted signing
and database secrets and internal service URLs, not the host-run values.

```powershell
docker compose --env-file .env -f infra\compose\compose.yml --profile infrastructure --profile applications up -d --build
docker compose --env-file .env -f infra\compose\compose.yml --profile infrastructure --profile applications ps
Invoke-RestMethod http://localhost:8000/health
docker compose --env-file .env -f infra\compose\compose.yml logs --tail 80 web agent
```

The agent health response includes `providerMode`. Live startup requires
non-synthetic `NEBIUS_API_KEY`, `NEBIUS_MODEL`, `MAPS_GROUNDING_API_KEY` and
`TAVILY_API_KEY`; Compose forwards all four to the agent. Never publish resolved
Compose configuration or raw environment dumps: they can contain credentials.
Changing the environment requires container recreation, not just `restart`.

### Live destination lookup

`/trips/new` resolves the destination search box and map country clicks through
`GET /api/v1/places`. Deterministic mode answers from the reviewed synthetic
catalogue. Live mode calls Google Places (New) text search and the Time Zone API
with `MAPS_GROUNDING_API_KEY`, which Compose now forwards to web as well as
agent, so the key must be enabled for both APIs. Country quick-picks, IATA-coded
airports and the fallback when text search fails come from the bundled
`web/server/supply/geo-catalogue.json` (GeoNames cities5000 and OurAirports,
regenerate with `pnpm --filter @onholidai/web geo:catalogue`). Without a key the
endpoint answers `503 place_lookup_unavailable` and the setup form reports the
outage instead of blaming the traveller's input.

Supplier discovery is a separate web-owned boundary. Compose forwards
`SUPPLIER_PROVIDERS`, `DUFFEL_READ_SECRET`, `NUITEE_SECRET`,
`NUITEE_ENVIRONMENT`, `VIATOR_SECRET` and `VIATOR_ENVIRONMENT` to web only.
Use those exact read-secret names in the JSON references, or provide an explicit
reviewed Compose override for different names. In particular, the historical
discovery-only reassignment to `DUFFEL_TRANSACTION_SECRET` is **not** forwarded
by the base Compose file. For Docker, provision that discovery-only token as
`DUFFEL_READ_SECRET` and reference that name, leaving transaction authority
absent. Do not forward all host secrets or share an actual booking credential
with web to make a missing reference resolve.

Live credentials alone do not establish verified supplier operations. Keep the
existing per-provider/product readiness gates, destination mappings, occupancy
and currency requirements. Missing readiness must remain an explicit unavailable
outcome, never synthetic live success. The base booking worker remains
deterministic; this planning configuration does not activate unfinished live
booking.

Trusted supplier identities are resolved inside the web composition root, never
by a model and never from a request parameter:

- Flights: a stored `providerPlaceIds["duffel:flight"]` wins; otherwise Duffel
  place suggestions (`GET /places/suggestions?query=<name>`) supply the gateway
  for a country or city destination and for a city departure without an IATA
  code. A failed lookup leaves the flight source `unsupported`.
- Stays: the destination name and country are resolved to a LiteAPI place id
  (`GET /v3.0/data/places`) before rates are read; guest nationality comes from
  the confirmed departure country because setup does not collect residence.
- Activities: `providerPlaceIds["viator:destination"]` is still required.

Resolution is cached in-process for ten minutes and bounded by its own timeout,
so a slow identity lookup degrades one component instead of the estimate. The
bundled place catalogue ranks airports by the population of the city they
serve (`airportClass` plus `rank`); regenerate it with
`pnpm --filter @onholidai/web geo:catalogue`.

For a request that appears to do nothing, inspect the browser's
`POST /api/v1/trips/{tripId}/agent-runs` response:

- **429 / `guest_research_limited`** is a web-side quota rejection, so no agent
  request is expected. Defaults are two active runs and ten accepted research
  requests per hour, shared across the guest session's trips. Runs awaiting a
  clarification count as active: answer their questions in the original trips.
  Queued/running leases expire after 90 seconds without progress; hourly usage
  ages out over an hour. Repeated immediate retries cannot bypass these limits.
  Compose forwards `GUEST_MAX_ACTIVE_RUNS`, `GUEST_MAX_RUNS_PER_HOUR` and
  `GUEST_MAX_SESSIONS_PER_HOUR`; do not disable abuse controls as a workaround.
- **503 / `agent_unavailable`** means dispatch could not be confirmed. Check
  agent health, startup settings and shared service signing secrets. The
  reservation remains durable: retry the same request instead of creating
  duplicates. The endpoint no longer hides this failure behind HTTP 202.
- **202** acknowledges a run; inspect its subsequent status/events and chat
  questions. It is not evidence of a completed plan or verified live inventory.

Chat honors `Retry-After`, preserves unsent text, and distinguishes a rejected
reservation from an uncertain dispatch. Rejected commands can be edited and
sent anew. Uncertain commands require replay before sending another message;
that replay retains the original request ID, message and base version.

As of 2026-10-25, feature 003 has 76 checked tasks and 28 unchecked tasks.
Agent-led automatic planning is the current customer flow; the retired manual
supplier panel is not a prerequisite. Remaining US4/US5 transaction/recovery,
live-access, accessibility and acceptance work is not certified by a working
deterministic agent or a healthy container. See the [current task list](../specs/003-supplier-mcp-booking/tasks.md).

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

## CI browser tests and runtime limits

The Playwright CI entry provisions its own disposable PostgreSQL/PostGIS service,
synthetic least-privileged roles and `onholidai_e2e` database, then applies every
checksum-verified migration. It does not use application or production credentials.
CI builds Next.js before testing to avoid cold development-route compilation
inside the agent's bounded HTTP requests. Playwright starts its production server
using a disposable, one-day localhost TLS certificate generated in the runner's
temporary directory. HTTPS keeps production Secure cookies usable in WebKit
without weakening cookie protections. Only the test browser and readiness client
accept this self-signed certificate. The same test server exposes a separate
HTTP listener on loopback at the browser port plus one for signed agent callbacks,
so the Python agent never needs to disable certificate validation.
Playwright starts the deterministic Python agent, waits for both services'
health endpoints, and stops the processes after the run. Local runs use `next dev` and may reuse
existing servers; CI never does. For local runs, provide a migrated `DATABASE_URL`
and the same `SERVICE_TOKEN_SECRET` to both processes before `pnpm test:e2e`.
Python 3.13 and uv are required as well as the Node.js/browser dependencies.
`PLAYWRIGHT_BASE_URL` and `AGENT_BASE_URL` can point to already running local
servers; the managed agent uses the port from `AGENT_BASE_URL` (8000 by default).

A global preflight checks the agent's deterministic mode, creates a real guest
session and draft, and loads the database-backed sign-in page before any browser
tests run. A healthy `/api/health` alone is only a web-process liveness signal.
Database failures now stop at preflight instead of cascading into repeated
"Saved" assertion or navigation timeouts. Fix dependency readiness rather than
raising test timeouts.

Pointer-drag tests scroll the entire route list into view before measuring
coordinates; Firefox does not reliably deliver drops outside the viewport.
Workspace version assertions use the exact `Saved version N.` text in the
**Trip details** region, not the removed `Committed version N` label.

Dispatch validation binds the agent command to its reserved application policy,
including automatic estimates and older reservations that omitted the manual
default. A policy-bearing reservation must not be rejected just because the agent
wire command omits this server-owned field.

All five desktop/mobile browser projects remain enabled. CI uses one browser
worker to limit competing browser/WebGL workloads, no automatic retries, a
five-failure cutoff and a ten-minute Playwright-wide
deadline. The suite step is capped at fifteen minutes, the enclosing job at
twenty; other jobs also have explicit limits. Expensive suites run only after
the web, foundation, agent and contract checks succeed. New commits cancel older
runs for the same branch/PR. These controls save GitHub Actions **runner minutes**,
not API tokens. The workflow still handles both push and pull-request events.
Failure traces and screenshots are retained in `web/test-results/` locally and
uploaded as `playwright-failures` in CI with three-day retention.

The conversation pane contains chat, material clarifications and saved-trip
checkpoints. Supplier comparison is internal to the estimate agent, not a
separate customer panel. The guest journey checks that the removed supplier
panel and manual research controls stay absent before restoring a saved version.

## Provider capabilities

Deterministic doubles are the default. Current search composition is Duffel Flights, Nuitee stays and Viator activities; Booking.com and Trainline are deferred, and GetYourGuide is replaced. Nuitee Flights/Experiences are inactive, with no fallback. Duffel stays remains a historical identity only: saved evidence/confirmations retain their original provider, but cannot be refreshed or used for new discovery/booking. Rail-only and mixed searches return an explicit unsupported/deferred rail outcome, without invoking rail adapters or substituting inventory. Supported mixed-query results are retained. Read-only HTTP transports, revisioned evidence and the four-tool in-memory MCP facade are implemented and tested with synthetic fixtures. This is discovery, not completion of [feature 003](../specs/003-supplier-mcp-booking/tasks.md) or verified supplier access.

Search results distinguish available inventory, successful no-matches, unconfigured/blocked access, unsupported coverage, rate limiting, deadlines and errors per provider/product. Source mode is explicit (`deterministic`, `live` or `unknown` for an undeclared injected client). The internal search route supplies product readiness and request cancellation; configured-but-unverified live access does not execute. Reads have an eight-second source ceiling, propagate abort, and deduplicate before fairly allocating up to 32 offers across products and requirement/selection groups. There are no default retries: only a trusted `SupplyReadError` with a bounded rate-limit delay can trigger one read retry, and only when that delay fits the original source deadline. The retry does not reset that deadline, and cancellation stops the wait without another supplier call. Arbitrary exception messages/payloads never become public retry guidance or error text. Search and evidence refresh enforce a twelve-second overall budget at access/persistence boundaries; cancelled or expired work cannot append evidence. Refresh rejects a known-stale revision before a supplier call and rechecks the latest revision under the source-run lock before appending, so concurrent refreshes cannot overwrite immutable evidence.

Live provider use requires separately provisioned credentials, commercial access, rate limits, and confirmation of the account's permitted operations. Availability, status lookup, idempotent writes, cancellation, and rescheduling are capability-specific; consult [supply contracts](../contracts/supply/README.md) and check the deployed adapter configuration before enabling an operation. An adapter declaration does not guarantee inventory or commercial access. Unknown outcomes stay `unknown` until reconciled; never retry an ambiguous provider write with a new key.

### Research evidence and live read prerequisites

Opening a draft starts its initial estimate automatically when setup supplied
a research request or a version-one trip has no components, daily plan or
existing run. Reloads
resume the existing run rather than starting another estimate. The estimate agent
searches suppliers and selects eligible offers internally; accepted changes
propagate to the map, trip plan and price through the existing trip refresh.
Only material choices requiring traveller input appear as chat clarifications.
Read-only supplier runs are excluded from the customer timeline and the
workspace's resumed planning run, including historical technical messages.
There is no manual **Research estimate** or supplier-selection panel; failed
submissions can be retried in chat with the same pending request identity.

Read-only `supplier_research` runs remain available through the research API.
Only `supplier_search`, `supplier_offer_details`,
`supplier_revalidate_offer` and `supplier_capabilities` are registered in its
in-memory MCP server. Owner/trip/run/version/token context is captured by the
server, not supplied by tool arguments. Signed callbacks use the web audience
and `trip:read` scope. No proposal scope or supplier secret reaches this facade.

Search evidence is separate from accepted components. Missing dates, terms and
details remain unknown. A discovery offer enters a draft proposal only when the
customer-payable total is known; an unknown supplier amount, platform margin or
payable tax/fee breakdown is carried as `null` rather than estimated, so the
draft keeps an authoritative `finalCustomerAmount` and unknown parts stay
explicit. Unknown fee breakdowns are recorded in backend evidence only
(`unavailableFacts`/`unverifiedFacts`), not shown as a customer warning. Booking
stays strict: `assertEstablishedPricing` rejects a snapshot whose components
still have an unknown breakdown with `409 price_breakdown_unverified` until
revalidation establishes supplier pricing. Details and revalidation
append immutable revisions with compare-and-swap. An unknown/failed read cannot
extend old evidence or grant booking authority. The browser may inspect its
current-version completed research; internal callbacks additionally require an
active, unrevoked grant for the same run. Source access and ownership are
rechecked after in-flight reads. All responses are private/no-store.

Capability responses distinguish the adapter's implemented read operations from
configured product access. Configuration cannot enable an unsupported operation:
Nuitee final revalidation remains unsupported even with a verified
configuration declaration. Detail/revalidation check their own product's support
and access, including Viator independently of Duffel. Blocked or unverified reads
preserve prior evidence without appending a revision. Coverage, property types,
rate limits and maximum freshness remain unknown where not established; query
and deadline ceilings are reported separately. Demonstration property variants
are synthetic fixtures, not evidence of live property coverage or age eligibility.

The web composition root resolves only configured read-secret references.
Duffel write keys are never used as a read fallback. Nuitee's and Viator's shared upstream
keys are constrained by fixed read endpoint/method allowlists, not by their names.
For Duffel, `readSecretRef` means the dedicated **discovery process** credential,
not an upstream read-only permission guarantee. Flight search creates an offer
request via POST and then reads one bounded page of offers sorted by total
amount (`GET /air/offers?offer_request_id=…&limit=32&sort=total_amount`) instead
of requesting every offer with the request. Test-mode offer requests return tens
of megabytes when all offers are included, which exceeds the bounded response
size, so paging is what keeps a search inside the client limit. The tested
read-only sandbox token returned HTTP 403 with
`insufficient_permissions`, although airline reads succeeded. Provision a
separate discovery token with the required offer-request permission (read-write
where Duffel offers only read-only/read-write), distinct from the worker token.
Its client remains confined to flight search and granted offer GETs: no Orders,
holds, payments or cancellation. Keep the current blocked/unverified readiness
until that dedicated token is independently tested; never substitute the
booking token or infer search success from key presence. Tokens must remain
server-only and test/live mode is still determined by the token.
`VIATOR_ENVIRONMENT` accepts `sandbox` (the default) or `production`; change it
only when deploying approved production access. Duffel test/live behavior is
determined by the injected read token, using its fixed API host.

Trusted supplier-location mappings are prerequisites, not invented from names
or internal destination UUIDs. Default Flights and Viator resolvers read
respectively `providerPlaceIds["duffel:flight"]` (IATA) and
`providerPlaceIds["viator:destination"]` (numeric supplier destination ID) from
the authoritative saved trip. Missing mappings return unsupported coverage.
Trusted deployments may inject `supplierMappings` at `createApplication`.

Setup records those identities when a place is selected. An airport candidate
from the bundled OurAirports catalogue contributes its own IATA code, so the
flight mapping is established offline. Cities and countries are resolved once at
selection through Viator free-text destination search
(`GET /api/v1/places/viator-destination`), which records an ID only when exactly
one supplier destination carries the same name; ambiguous or failed lookups leave
the destination unmapped and coverage unverified. The lookup requires a live
Viator read credential and a sandbox/production match, is cached per term, and
never blocks setup. Deterministic mode records no supplier identities.
Nuitee stays additionally requires separately verified sandbox/production access and
an explicit trusted `staySearch` resolver returning nationality, exact room allocation
(including child ages), and either bounded supplier `hotelIds` or a `placeId`.
The current trip schema does not establish those facts automatically: the default
resolver returns an explicit access prerequisite without calling Nuitee.
Never infer nationality, room count or service-date eligibility from destination names.
Nuitee uses fixed `POST /v3.0/hotels/rates` and `GET /v3.0/data/hotel` endpoints on
`api.liteapi.travel`, with a six-second transport ceiling within the existing
eight-second source/twelve-second overall limits. Property detail is restricted
to an offer and query previously returned by this client; process restart or
bounded grant eviction may require a new search. Previously persisted evidence
remains readable. Arbitrary hotel IDs/URLs cannot be forwarded from tool input.
Array-valued offer prices, per-room totals and occupancy numbers are checked
against the selected allocation. Public display uses only sourced suggested
selling price plus known excluded fees in the same currency, never net cost or
invented margin. Missing fees, foreign-currency property charges and package/
membership restrictions leave the public total unknown; included fees are not
added again. Dates remain date-only research facts, not fabricated timezone
instants. No expiry, checkout payment schedule or complete booking terms are invented.
Prebook creates a checkout session; `usePaymentSdk=false` does not establish
read-only safety. No prebook, payment or booking endpoint is included in this
client, and Nuitee final revalidation/new transactions remain blocked.
Viator availability requires an exact day and trusted product age-band mapping;
`ageAtTripStart` alone does not establish service-date eligibility.

### Historical Duffel Stays evidence (not current activation)

The following Duffel Stays observations are historical and confer no Nuitee
approval. Duffel stays is now inactive regardless of a saved declaration. On
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

### Browser-only booking demo

Set `BOOKING_DEMO_ENABLED=true` **in the web process**, then restart it. The flag
defaults to false and is independent of `PROVIDER_MODE`; it does not activate live
discovery or supplier booking access.

For a host-run web app, from the repository root:

```powershell
$env:BOOKING_DEMO_ENABLED = 'true'
corepack.cmd pnpm --dir web dev
```

For Compose, put `BOOKING_DEMO_ENABLED=true` in the root environment file and
explicitly pass that file when recreating the web service:

```powershell
docker compose --env-file .env -f infra\compose\compose.yml --profile applications up -d --build web
```

Open an existing trip's booking review. The page displays a persistent demo notice,
the saved trip and illustrative total, an acknowledgement, simulated processing and
a demo confirmation/reference. Account linking, live finalization/terms, passport,
card information and transaction credentials are not needed. A guest still needs
access to their own saved trip; private and cancelled trips remain protected.
An itinerary without selected services is explicitly an itinerary-only preview.

Demo booking buttons make **no backend requests**: no revalidation, authorization,
booking/status polling, SSE, supplier calls, payment, email, trip changes or durable
confirmation. Simulation and consent exist only in browser memory; reset, reload or
leaving the page clears them. Existing saved bookings are never changed. Initial
page loading still authenticates/authorizes and reads the saved trip normally.
This flag changes presentation only; it is not a new server transaction authority
or a replacement for disabling real workers/maintaining existing dispatch gates.
Set it to false/remove it and restart/recreate the web process to restore real
review/authentication behavior. Production booking tasks remain incomplete.

A Duffel read-write token can technically support flight discovery if it has the
required offer-request permission; its environment-variable name is not an upstream
scope. On 2026-10-24 the user explicitly authorized testing the sandbox token in
`DUFFEL_TRANSACTION_SECRET`: shopping returned HTTP 201 and 16 EUR offers; the exact
selected-offer GET returned HTTP 200 and normalized/publicly projected successfully.
No order, hold, payment or other consequential endpoint was called.

The user then selected **discovery-only reassignment**, not sharing: the local Duffel
entry now has `readSecretRef: "DUFFEL_TRANSACTION_SECRET"` and **no**
`transactionSecretRef`. The variable keeps its existing name/value but no longer
supplies a configured worker role. The old `DUFFEL_READ_SECRET` value is untouched
and unreferenced. Existing validation still rejects shared references/values when
both roles are configured. Re-enabling booking later requires a distinct worker
credential and the unchanged operation/exact-consent gates; there is no fallback.
The protected environment example was not read or changed.

`BOOKING_DEMO_ENABLED=true` and `PROVIDER_MODE=deterministic` were preserved. This
role reassignment does **not** silently switch the app to real supplier discovery
or promote operation declarations to verified. Live discovery remains independently
gated for every supplier, destination/party prerequisite and query currency.
The observed Duffel offers are **EUR**: a GBP query is correctly unsupported, not
a permissions failure. An EUR-scoped trip/query can use those EUR results; existing
trip currencies were not changed and no exchange rate was invented. Final customer
costs remain unknown where surcharges/terms are missing, independently of the
client-only booking demo.

### Supplier readiness configuration

`SUPPLIER_PROVIDERS` is JSON containing only optional `duffel`, `nuitee` and `viator` entries. Remove old Booking.com/Trainline/GetYourGuide entries from current configuration; their presence is a validation error, not an activation request. This does not migrate or delete historical trip/booking data.

Each entry has `readSecretRef`, `transactionSecretRef` and `products`. References name separately provisioned environment secrets, not literal API keys. Active products are Duffel `products.flight`, Nuitee `products.accommodation` and Viator `products.activity`. Duffel `products.accommodation` declarations remain accepted for legacy status compatibility, but cannot activate any new stay operation. Each product has an `operations` map for `search`, `detail`, `revalidation`, `book`, `status`, `idempotency`, `cancel` and `reschedule`. Each operation records `support` (`supported`, `unsupported`, `unknown`), `access` (`unconfigured`, `configured_unverified`, `verified`, `blocked`), and optional approved `evidenceRef` / ISO `verifiedAt`. Nuitee verified declarations additionally require `environment` matching `NUITEE_ENVIRONMENT` (`sandbox` by default, or `production`). Missing facts remain unknown; key presence alone never verifies an operation, payment access or Viator booking entitlement.

Viator also accepts `accessTier`: `unknown` (default), `affiliate_basic`,
`affiliate_full`, `affiliate_full_booking` or `merchant`. The user confirms
Basic affiliate sandbox access, so record `accessTier: "affiliate_basic"` in
the Viator JSON entry when updating local configuration. Do not set merchant
without actual approval. Basic/unknown tiers cannot enable this worker's
merchant booking actions even if an operation is declared verified.
`affiliate_full_booking` can establish approved saved-status access, not
merchant booking. Merchant/status verification must include `environment`
matching `VIATOR_ENVIRONMENT`, in addition to existing evidence and credentials.
Old JSON without a tier still parses but defaults to unknown and cannot assert
merchant booking readiness. Discovery readiness remains independent.

For example, this intentionally unverified configuration permits one shared upstream key for each of Nuitee and Viator, not fictional separately scoped keys:

```json
{
  "duffel": {
    "readSecretRef": "DUFFEL_READ_SECRET",
    "transactionSecretRef": "DUFFEL_TRANSACTION_SECRET",
    "products": {
      "flight": {
        "operations": { "search": { "support": "supported", "access": "configured_unverified" } }
      }
    }
  },
  "nuitee": {
    "readSecretRef": "NUITEE_SECRET",
    "transactionSecretRef": "NUITEE_SECRET",
    "products": {
      "accommodation": {
        "operations": {
          "search": {
            "support": "supported",
            "access": "configured_unverified",
            "environment": "sandbox"
          },
          "detail": {
            "support": "supported",
            "access": "configured_unverified",
            "environment": "sandbox"
          }
        }
      }
    }
  },
  "viator": {
    "accessTier": "unknown",
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

Provision Duffel's distinct discovery and booking keys only in web and worker respectively. `DUFFEL_READ_SECRET` can hold the separate search-permitted discovery token without renaming the variable or changing supplier JSON. Identical references are rejected, as are identical nonempty key values when both are supplied to one process. Distinct references cannot prove upstream scope: verify actual Duffel permissions separately. The same Nuitee or Viator secret reference/value may be provisioned in trusted web-read and worker processes; this does not grant a read-only upstream scope or activate transactions. No supplier key belongs in Python, MCP, browser configuration, logs or workflow history.

The desired commercial model is one customer payment to OnHolidai, followed by
separate approved supplier settlement. Prefer Nuitee enterprise `CREDIT` under
contract, with an approved funded wallet/account-card arrangement only as an
explicit interim alternative; use Duffel Balance and Viator merchant terms.
Maintain working capital/credit independently of customer PSP payout timing.
Basic Viator affiliate access is insufficient for this flow. Final terms,
prebook effects, capture/refund/uncertainty policy and commercial/legal/PSP
approval remain gates; no processor or live funding path is installed.
See [the supplier/funding assessment](../specs/003-supplier-mcp-booking/research.md#2026-10-24-supplier-sufficiency-and-single-customer-payment-direction).

The environment-example file is access-restricted in this implementation session.
On 2026-10-23 the user confirmed completing the requested manual configuration
updates, including Nuitee and the single-line supplier JSON. This is user-reported
confirmation, not independent inspection of environment files. A configuration
regression validates the supplied secret-free JSON without loading those files.
Keep server-only `NUITEE_SECRET` private and `NUITEE_ENVIRONMENT=sandbox`;
keep `PROVIDER_MODE=deterministic` until independent operation/environment
verification and trusted search facts are provisioned. No key values should be
pasted into chat. The current foundation gate passed 44 tests without skips
against a disposable synthetic PostGIS cluster; see the
[current verification record](../specs/003-supplier-mcp-booking/evidence/provider-readiness.md#2026-10-23-manual-confirmation-and-foundation-closeout).

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

## Production deployment

The hosted instance runs as one Compose project (`onholidai-production`) under `/srv/onholidai` on the Leaseweb VPS, with Caddy terminating TLS for `onholidai.nl` and publishing only ports 80 and 443. Application images are built by `.github/workflows/release.yml`, pushed to GHCR, and deployed by digest through `infra/production/scripts/deploy-vps.sh`; the script applies migrations through the migration role before replacing running services and refuses mutable tags.

Host preparation is `infra/production/scripts/bootstrap-vps.sh` (Docker, swap, firewall, unattended upgrades, Docker secret files). Backups run daily from `onholidai-backup.timer` and are verified before the run reports success. Release layout, required GitHub secrets, rollback, and routine commands are documented in [the production runbook](../infra/production/README.md).

The production stack does not include Jaeger, the Temporal UI, or the OTel collector. Do not set `OTEL_EXPORTER_OTLP_ENDPOINT` there until a collector exists, and keep the synthetic provider doubles out of the production environment file.
