<p align="center">
  <img src="../web/public/logo/main_logo.svg" alt="OnHolidai" width="320" />
</p>

# Shared contracts

OnHolidai connects a web workspace, a planning agent, and travel suppliers. These contracts keep their APIs and data formats aligned so a change in one service does not silently break another.

[Project overview](../README.md) | [Development and testing](../docs/development.md) | [Operations](../docs/operations.md)

## Find the interface you need

| Area              | Contract                                                    | What it describes                                                     |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Planning agent    | [Agent OpenAPI](agent-api/openapi.yaml)                     | Requests, run lifecycle, results, and scoped service communication    |
| Agent tools       | [Tool schemas](agent-api/tools.schema.json)                 | Structured inputs and outputs used by the planning agent              |
| Web API           | [Web OpenAPI](trip-domain/web-api.openapi.yaml)             | Browser-facing trip, planning, and booking endpoints                  |
| Trip state        | [Snapshot schema](trip-domain/snapshot-v1.schema.json)      | Immutable, versioned trip data                                        |
| Daily planning    | [Itinerary schema](trip-domain/itinerary-v1.schema.json)    | Daily activities, travel times, and feasibility evidence              |
| Booking review    | [Review schema](trip-domain/booking-review-v2.schema.json)  | Public review, exact terms, consent, attempts, and booking status     |
| Supplier tools    | [Supplier MCP schema](supply/supplier-tools-v1.schema.json) | Read-only capabilities, search, details, and revalidation tools       |
| Supplier evidence | [Internal offer schema](supply/offers-v1.schema.json)       | Normalized source evidence and immutable offer revisions              |
| Public offers     | [Public offer schema](supply/public-offers-v1.schema.json)  | Customer-visible offer data without supplier economics or credentials |
| Trip updates      | [Event schema](events/trip-events-v1.schema.json)           | Versioned trip events shared between services and the workspace       |

## Plan, research, and booking stay separate

The agent can research a destination and propose changes to a trip. It does not receive supplier transaction credentials or model-callable booking tools.

Supplier MCP tools form an internal application interface. They connect the agent to the web-owned gateway, which talks to Duffel, Nuitee, and Viator. They are not a claim that those companies expose public MCP servers.

Research produces offer references and source evidence. Adding an offer to a draft does not reserve inventory. Booking requires a separate review, fresh supported terms, and authorization for the exact action.

Current whole-trip starts can record a durable attempt and outbox intent, but provider execution is not activated for that path. An attempt or simulated confirmation is not proof of a real reservation.

## Handle prices and unknown facts honestly

- Money uses integer minor units with an explicit ISO currency.
- Public projections expose customer pricing, not supplier costs, platform margin, or secrets.
- Missing fees, dates, eligibility, or cancellation terms remain unknown instead of becoming favorable assumptions.
- Source mode and freshness distinguish deterministic examples from live supplier evidence.
- Offer details and revalidation append immutable revisions rather than overwriting prior evidence.
- Booking needs established pricing and supported final terms even when a draft can display a sourced total.

Do not combine currencies without approved conversion evidence or infer a booking capability from the presence of a key.

## Keep changes compatible

1. Update the owning domain or agent schema.
2. Regenerate its exported artifacts and consumer declarations.
3. Check required fields, references, versions, and public/private projections.
4. Run both consumer and producer contract tests.
5. Apply any required database migration before deploying compatible web and worker revisions together.

Some maintained contract documents have synchronized source copies. Use the existing generators and drift checks rather than changing a published copy in isolation.

### Regenerate exported contracts

Run from the repository root after installing the [development dependencies](../docs/development.md#your-development-toolkit):

```bash
uv run --project agent python agent/scripts/export_contracts.py
pnpm --dir web agent:contracts
pnpm --dir web snapshot:contract
```

The agent exporter writes OpenAPI and tool schemas from the Python models. The web generators update agent consumer declarations and the trip, itinerary, offer, and booking-review schemas from their canonical definitions.

Generator entry points:

- [Agent exporter](../agent/scripts/export_contracts.py)
- [Agent consumer generator](../web/scripts/generate-agent-contracts.ts)
- [Trip and public-schema generator](../web/scripts/generate-snapshot-contract.mjs)

### Check for drift

```bash
pnpm test:contracts
```

This checks references and generated output, then runs the web and Python contract suites. A generator check, schema validation, and behavior test answer different questions. Keep all applicable checks passing.

Use the [operations guide](../docs/operations.md#connect-live-travel-sources) for provider credentials, readiness states, and supplier-specific prerequisites.
