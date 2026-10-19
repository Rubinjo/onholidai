# Four-step supplier discovery evidence

This records the requested bounded discovery implementation, not completion of
all feature 003 tasks, production readiness, or supplier access approval.
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

| Check | Executed result |
| --- | --- |
| Final web supplier/access/UI/config/refinement/agent-schema run, Vitest `--maxWorkers=2` | 154 passed across 15 files, zero skipped |
| `corepack.cmd pnpm --dir web test:foundation --maxWorkers=2` | 43 passed across 4 files, zero skipped/unhandled errors; migration 014 applied |
| Final query-scoping/UI/agent-schema follow-up, Vitest `--maxWorkers=2` | 51 passed across 5 files, zero skipped |
| Provider HTTP wire subset (included in the focused run) | 44 passed; no external HTTP |
| Python offer-completeness, integration, estimate evaluation, refinement/model/schema/API/export subset | 101 passed; includes actual MCP list/call and no-rail regressions |
| `corepack.cmd pnpm --dir web typecheck` and focused ESLint | Passed |
| Targeted Python Ruff and Pyright | Passed; zero type errors/warnings |
| `node --experimental-strip-types scripts\validate-contracts.mjs` | Passed, including 15 shared supply cases |
| `corepack.cmd pnpm --dir web snapshot:contract:check` | Passed for accepted snapshots, itinerary and internal/public discovery |
| `corepack.cmd pnpm --dir web agent:contracts:check` and Python exporter `--check` | Passed |

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

## Separate pending gates

- Supplier sandbox/live operation-specific approvals and executed evidence.
  Keys alone do not establish permission or verified readiness.
- Approved Stays read-only/no-hold quote semantics, full mandatory amounts and
  room allocation. Quote/revalidation is intentionally unsupported, not guessed.
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

| Product | Fixed read allowlist |
| --- | --- |
| Duffel Flights, API v2 | `POST /air/offer_requests?return_offers=true`; `GET /air/offers/{offerId}` |
| Duffel Stays, API v2 | `POST /stays/search`; `POST /stays/search_results/{searchResultId}/actions/fetch_all_rates` |
| Viator Partner API 2.0 | `POST /products/search`; `GET /products/{productCode}`; `POST /availability/check` |

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
round-trip dates. Offset-free source flight timestamps stay unknown. Viator
availability needs one exact day and one available option, not a silent choice
among multiple options. Stays rate detail is not quote creation or revalidation.
