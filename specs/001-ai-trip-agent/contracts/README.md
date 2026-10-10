# Contract Ownership

These contracts define the boundaries among the browser, `web/`, `agent/`, Temporal workers, and travel suppliers.

| Contract | Producer | Consumers | Compatibility rule |
|---|---|---|---|
| `web-api.openapi.yaml` | `web/` | Browser and end-to-end tests | Additive within `v1`; incompatible changes require a new version |
| `agent-api.openapi.yaml` | `agent/` Pydantic models | `web/` internal client | Generated OpenAPI is authoritative; generated TypeScript and Zod artifacts must be current |
| `agent-tools.schema.json` | Agent/domain design | LangGraph tool adapters and evaluation tests | Tool names and versioned schemas are allowlisted; transactional tools are forbidden |
| `travel-supply.md` | First-party supply boundary | Search services and Temporal activities | Read and transaction capabilities remain separate; provider additions preserve normalized outcomes |

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
- Every mutation carries `requestId` and `expectedVersion` where trip state is involved.
- Errors use stable machine codes plus safe user-facing messages and a correlation ID.
- SSE events are versioned, monotonically ordered, replayable by cursor, and contain no direct trip mutation command.
- Browser credentials never cross into `agent/`; internal actor context uses a short-lived service credential.
