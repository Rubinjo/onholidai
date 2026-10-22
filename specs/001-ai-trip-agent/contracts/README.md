# Contract Ownership

These contracts define the boundaries among the browser, `web/`, `agent/`, Temporal workers, and travel suppliers.

| Contract                  | Producer                    | Consumers                                    | Compatibility rule                                                                                 |
| ------------------------- | --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `web-api.openapi.yaml`    | `web/`                      | Browser and end-to-end tests                 | Additive within `v1`; incompatible changes require a new version                                   |
| `agent-api.openapi.yaml`  | `agent/` Pydantic models    | `web/` internal client                       | Generated OpenAPI is authoritative; generated TypeScript and Zod artifacts must be current         |
| `agent-tools.schema.json` | Agent/domain design         | LangGraph tool adapters and evaluation tests | Tool names and versioned schemas are allowlisted; transactional tools are forbidden                |
| `travel-supply.md`        | First-party supply boundary | Search services and Temporal activities      | Read and transaction capabilities remain separate; provider additions preserve normalized outcomes |

The Pydantic exporter maintains identical source/promoted agent OpenAPI and tool schemas. T006 promotes the other source contracts to `contracts/agent-api/openapi.yaml`,
`contracts/agent-api/tools.schema.json`, `contracts/trip-domain/web-api.openapi.yaml`,
and `contracts/supply/README.md`. Promoted files are exact copies except that the promoted
web contract rewrites `./agent-api.openapi.yaml` references to `../agent-api/openapi.yaml`.
The executable validator rejects source/promotion drift and unresolved local or file references.

## Clarified Handoffs (2026-10-10)

- `/places` is an authenticated bounded lookup. Results include country, timezone and explicit identity; deterministic mode labels its synthetic catalogue. Live lookup is unavailable until a live geographic adapter is connected.
- Web internal reads and proposal recording use web-audience `trip:read` and `proposal:create` grants. Headers `x-user-id` and `x-request-id` must match the signed claims; the agent-view base version and path trip must also match. Proposal recording verifies the reserved run identity in PostgreSQL before persisting.
- Pricing diagnostics require a separate signing secret, web-audience `pricing:read`, an explicit `version` (or `x-base-trip-version`), and a database-held `pricing_auditor`/`administrator` role. The implementation also checks trip ownership. The pricing secret is excluded from agent configuration.
- New browser drafts submit an empty public estimated price, empty components and empty itinerary. Web constructs the full internal zero-price snapshot and creates version one with an actor-scoped receipt through the shared commit boundary. Customer-supplied supplier costs, margins or confirmations are rejected.

- `AgentResult.kind=proposal` is the only structured estimate handoff: purpose initial_estimate, initiatingRequestId, baseTripVersion and draft-only operations. No opaque answer text or SSE payload can be applied. Web records the proposal, resolves trusted offer facts/recomputes price, and waits for explicit UI acceptance in US1.
- Web persists events/results through scoped internal PUT callbacks before SSE/status delivery. Requests include run/trip/user/base-version/request identity; credentials have web audience and run:write bound to that run. These infrastructure callbacks are not model tools. Exact replay returns the original receipt; changed fingerprints, cursor gaps or unmatched result/event pairs return 409 atomically. Progress renews a 90-second lease every 15 seconds; expired queued/running runs become failed/interrupted and require an explicit new research request; awaiting_clarification suspends the lease until resume.
- Internal SSE objects become public envelopes with version/runId/cursor/type/occurredAt preserved and type-specific fields under payload; public proposal fields are enriched from the web repository and prices are customer-safe. Before publishing, validate both schemas and the receipt cursor.
- Clarification forwarding preserves the original run request identity. Conversation and version reads return only actor-authorized redacted messages, immutable snapshots, initiating requests, affected facts and reversibility metadata.
- Direct edits are two-step commands: `edit-preview` returns complete material impacts, a preview snapshot and an expiring fingerprint; `edit` accepts only the same operations, base version and fingerprint. Proposal rejection never mutates the trip.
- Revalidation status is independently readable and returns one typed unchanged/changed/unavailable/unknown outcome per component plus immutable customer-safe terms/hash/expiry when complete. Recovery is status-first. Cancellation and rescheduling consume operation- and component-scoped authorization; rescheduling has separate revalidation, authorization and execution routes and cannot imply changes to unrelated components.
- Supplier costs and platform margins appear only on the internal pricing diagnostic guarded by an internal credential and the `pricing_auditor` or `administrator` role. Browser trip, event, booking and revalidation projections remain customer-safe.
- departureOrigin is a confirmed disambiguated city/airport with country and timezone; default return is that origin. Draft operation allowlists include departureOrigin. Legacy snapshots require explicit migration/confirmation, never an inferred origin.
- Closed object schemas declare every legitimate field in the object that closes them. `allOf` is used only to refine already-declared fields or requirements; event variants are flattened rather than extending a closed base object.
- Booking start/first write validates authorization against the exact current version; later writes use immutable executionBasis plus a provenance-checked status/evidence-only version chain. All material facts stay bound and expiry is checked before every write. New confirmed prices/terms, external edits or ambiguous write claims stop dispatch.
- These contracts remain pre-release v1. Agent models and their export/generation pipeline are implemented; run execution, callbacks and later story routes are separate tasks. After deployment, incompatible changes require a new contract version and snapshot migration.

## Contract Pipeline

Run `uv run --project agent python agent/scripts/export_contracts.py`, then `pnpm --dir web agent:contracts`. Their `--check` / `agent:contracts:check` modes fail on drift. `pnpm test:contracts` and CI execute these checks. Agent `.yaml` files contain deterministic JSON, which is valid YAML 1.2. The web callback request/receipt schemas reference the exported Pydantic definitions instead of duplicating their fields.

Generated validators preserve closed objects, tagged alternatives, Unicode character limits, defaults, JSON depth/byte budgets, protected draft targets/values and cross-field request/version/state rules. `x-equal-fields`, `x-not-future-fields`, `x-json-bound`, `x-nonblank` and `x-protected-target` encode rules that plain schema consumers must enforce separately; the generator fails on unsupported schema/conditional keywords. Historical summaries retain their source version without claiming a future version; the authoritative trip projection matches the run base exactly. The 36 synthetic cases in `contracts/agent-api/validation-cases.json` are exercised by Pydantic and generated-Zod suites; they are independent of the frozen usability/evaluation corpus.

An omitted first-run conversation summary resolves to empty lists bound to the reserved trip version via `PromptContext.resolved_summary`. Schema validation alone cannot prove signed actor grants, persisted cursor continuity, receipt durability or result-after-event ordering; the runtime storage/transport tasks enforce those boundaries.

1. Pydantic request, response, event, and error models generate the internal agent OpenAPI document.
2. TypeScript types and Zod runtime validators are generated from the committed document.
3. The customer-facing web API is described independently because `web/` owns authentication, trip commands, pricing projection, and booking initiation.
4. Contract checks fail when generated artifacts differ, a version is removed without migration, unknown event types are emitted, or production projections contain internal pricing fields.
5. Logs and examples use synthetic identifiers and redacted values.

## Shared Rules

US3 adds GET `/trips/{tripId}/commands/finalize` for a saved-version policy report and POST for the explicit planning transition. POST binds the request, actor, exact version and report fingerprint, requires acknowledgement of disclosed unknowns/exceptions, and blocks known conflicts. It never authorizes booking. Finalization proposals update daily planning only and use the existing durable callback/acceptance flow; web discards model assertions of verified supplier evidence. Additive optional item evidence, destination timezone and component detail fields preserve older v1 snapshots; absent fields remain unverified. `contracts/trip-domain/itinerary-v1.schema.json` is exported alongside the snapshot by `pnpm --dir web snapshot:contract`.

- All timestamps use RFC 3339 UTC unless explicitly named as local date/time with an IANA timezone.
- Money uses ISO 4217 currency plus integer minor units.
- Identifiers are opaque UUIDs unless a provider reference is explicitly named.
- Every mutation carries `requestId` and `expectedVersion` where trip state is involved. Infrastructure callbacks persist run/event/result records only and cannot mutate trip snapshots; they use the reserved baseTripVersion plus monotonic event cursor.
- Errors use stable machine codes plus safe user-facing messages and a correlation ID.
- SSE events are versioned, monotonically ordered, replayable by cursor, and contain no direct trip mutation command.
- Browser credentials never cross into `agent/`; internal actor context uses a short-lived service credential.

US1 transport is implemented at `/internal/v1/agent-runs` on agent and `/api/v1` on web. Web reserves the run identity/fingerprint before dispatch; first-run conversationId is omitted/null and web allocates it. Public results contain a trusted common proposal; SSE variant fields appear under payload. Scoped status/replay/dispatch-validation/resume-receipt/planning-search endpoints bind user/trip/request/base context. Quotes retain their query and optional selectionGroup so alternatives are not summed together. Partial results cannot authorize proposal acceptance.
