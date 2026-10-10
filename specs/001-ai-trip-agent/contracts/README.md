# Contract Ownership

These contracts define the boundaries among the browser, `web/`, `agent/`, Temporal workers, and travel suppliers.

| Contract | Producer | Consumers | Compatibility rule |
|---|---|---|---|
| `web-api.openapi.yaml` | `web/` | Browser and end-to-end tests | Additive within `v1`; incompatible changes require a new version |
| `agent-api.openapi.yaml` | `agent/` Pydantic models | `web/` internal client | Generated OpenAPI is authoritative; generated TypeScript and Zod artifacts must be current |
| `agent-tools.schema.json` | Agent/domain design | LangGraph tool adapters and evaluation tests | Tool names and versioned schemas are allowlisted; transactional tools are forbidden |
| `travel-supply.md` | First-party supply boundary | Search services and Temporal activities | Read and transaction capabilities remain separate; provider additions preserve normalized outcomes |

## Clarified Handoffs (2026-10-10)

- `AgentResult.kind=proposal` is the only structured estimate handoff: purpose initial_estimate, initiatingRequestId, baseTripVersion and draft-only operations. No opaque answer text or SSE payload can be applied. Web records the proposal, resolves trusted offer facts/recomputes price, and waits for explicit UI acceptance in US1.
- Web persists events/results through scoped internal PUT callbacks before SSE/status delivery. Requests include run/trip/user/base-version/request identity; credentials have web audience and run:write bound to that run. These infrastructure callbacks are not model tools. Exact replay returns the original receipt; changed fingerprints, cursor gaps or unmatched result/event pairs return 409 atomically. Progress renews a 90-second lease every 15 seconds; expired queued/running runs become failed/interrupted and require an explicit new research request; awaiting_clarification suspends the lease until resume.
- Internal SSE objects become public envelopes with version/runId/cursor/type/occurredAt preserved and type-specific fields under payload; public proposal fields are enriched from the web repository and prices are customer-safe. Before publishing, validate both schemas and the receipt cursor.
- departureOrigin is a confirmed disambiguated city/airport with country and timezone; default return is that origin. Draft operation allowlists include departureOrigin. Legacy snapshots require explicit migration/confirmation, never an inferred origin.
- Booking start/first write validates authorization against the exact current version; later writes use immutable executionBasis plus a provenance-checked status/evidence-only version chain. All material facts stay bound and expiry is checked before every write. New confirmed prices/terms, external edits or ambiguous write claims stop dispatch.
- These contracts are unimplemented v1 design drafts. Required origin/purpose fields are synchronized before first release; after deployment incompatible changes require a new contract version and snapshot migration.

## Contract Pipeline

1. Pydantic request, response, event, and error models generate the internal agent OpenAPI document.
2. TypeScript types and Zod runtime validators are generated from the committed document.
3. The customer-facing web API is described independently because `web/` owns authentication, trip commands, pricing projection, and booking initiation.
4. Contract checks fail when generated artifacts differ, a version is removed without migration, unknown event types are emitted, or production projections contain internal pricing fields.
5. Logs and examples use synthetic identifiers and redacted values.

## Shared Rules

- All timestamps use RFC 3339 UTC unless explicitly named as local date/time with an IANA timezone.
- Money uses ISO 4217 currency plus integer minor units.
- Identifiers are opaque UUIDs unless a provider reference is explicitly named.
- Every mutation carries `requestId` and `expectedVersion` where trip state is involved. Infrastructure callbacks persist run/event/result records only and cannot mutate trip snapshots; they use the reserved baseTripVersion plus monotonic event cursor.
- Errors use stable machine codes plus safe user-facing messages and a correlation ID.
- SSE events are versioned, monotonically ordered, replayable by cursor, and contain no direct trip mutation command.
- Browser credentials never cross into `agent/`; internal actor context uses a short-lived service credential.
