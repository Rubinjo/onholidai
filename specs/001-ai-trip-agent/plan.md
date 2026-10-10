# Implementation Plan: AI Trip Planning Agent

**Branch**: `001-ai-trip-agent` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-ai-trip-agent/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Build a two-service travel-planning monorepo in which the Next.js application owns authenticated user interaction, authoritative trip state, proposal validation, and customer-visible pricing, while the FastAPI/LangGraph service orchestrates the LLM and read-only research tools to produce typed recommendations and trip-change proposals. PostgreSQL/PostGIS persists trips, versions, conversations, offers, prices, and booking outcomes. Temporal executes revalidation and booking as explicitly authorized, idempotent workflows outside the conversational agent boundary. The three-pane interface synchronizes through versioned contracts and exposes map-equivalent accessible controls.

## Technical Context

**Language/Version**: Node.js 24 LTS with TypeScript for Next.js and TypeScript Temporal workers; Python 3.13 for FastAPI, LangGraph, and any future Python Temporal worker; pnpm 10 and uv with committed lockfiles

**Primary Dependencies**: Next.js App Router, React, Better Auth, Zod, TanStack Query, Tailwind CSS, shadcn/ui, Radix UI, MapLibre GL JS, React DayPicker, date-fns; FastAPI, Pydantic, LangGraph, OpenAI-compatible Nebius client; Temporal TypeScript and Python SDKs; OpenTelemetry and LangSmith

**Storage**: PostgreSQL 18 with PostGIS; Kysely and `pg` from the web service; numbered SQL migrations run by one controlled migration job; immutable JSONB trip-version snapshots plus spatial columns and GiST indexes; Redis deferred until a measured caching, coordination, or rate-limiting need justifies it

**Testing**: Vitest for TypeScript unit/integration tests, pytest for Python unit/integration tests, Playwright for end-to-end and accessibility journeys, deterministic provider/MCP doubles, Temporal workflow tests

**Target Platform**: Latest two stable Chrome, Edge, Firefox, and Safari releases, corresponding mobile browsers, and Firefox ESR; Linux containers orchestrated locally with Docker Compose v2; GitHub Actions on `ubuntu-24.04`

**Project Type**: Monorepo containing a full-stack web application and a Python agent service, with cross-language contracts and background workers

**Performance Goals**: Initial trip estimate visible within 30 seconds for at least 95% of valid requests; accepted draft state reflected consistently in all panes within 2 seconds; direct trip reads and edits feel interactive; map interactions remain smooth for a complete consumer itinerary

**Constraints**: Authoritative trip mutations require optimistic version checks; agent tools cannot directly mutate trips or execute bookings; all consequential actions require exact-term authorization and idempotency; production responses must not expose supplier cost or margin; sensitive data is excluded from prompts and general telemetry; all core journeys must be keyboard and screen-reader operable

**Scale/Scope**: MVP target of 10,000 registered users, 1,000 daily active users, 100 concurrent planning sessions, 5,000 estimate/refinement requests per hour, and 20 booking starts per minute; up to 10 travellers, 8 destinations, and 32 components per trip; trip/booking/audit data retained 24 months after activity and raw conversation content retained 90 days unless legal policy requires otherwise

### Selected Integration Patterns

- **Browser boundary**: Next.js is the authenticated backend-for-frontend. Better Auth sessions remain in `web/`; internal FastAPI calls carry a short-lived service credential and explicit actor, trip, request, scope, and base-version context.
- **Agent transport**: JSON handles durable reads and commands. Agent runs start asynchronously and emit versioned server-sent events for progress, clarification, proposal, and completion, with status polling as fallback.
- **Cross-language contracts**: Pydantic models generate versioned OpenAPI/JSON Schema artifacts; generated TypeScript types and Zod validators consume them. Contract tests run in both services.
- **Trip persistence**: `web/` exclusively owns application tables. Mutations use `expectedVersion`, append a complete immutable trip snapshot, conditionally advance the current version, and commit downstream events to a PostgreSQL outbox in one transaction.
- **Agent boundary**: `get_trip` and `retrieve_relevant_context` are bounded reads. `propose_trip_changes` emits a typed proposal only. The web domain validates and applies accepted non-transactional proposals; stale proposals return a conflict and never merge silently.
- **Context policy**: Stable instructions and tools precede dynamic context. Prompts use the compact trip state, structured summary, recent turns, and targeted retrieval; compaction begins at 70% of the model budget or 100 turns.
- **Supply boundary**: Planning search is read-only. Booking, payment, cancellation, and rescheduling interfaces are unavailable to LangGraph and callable only by authorized TypeScript Temporal workflows.
- **Booking execution**: Revalidation creates an immutable terms snapshot whose hash, user, trip version, and expiry define authorization. Booking runs as an idempotent per-component saga with explicit unknown and action-required states and conservative recovery.
- **Telemetry**: OpenTelemetry correlates web, agent, workflows, and adapters using allowlisted attributes. LangSmith receives redacted typed traces; raw production prompts, responses, sensitive traveller facts, supplier costs, and margins are excluded by default.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Optimize for Deletion, Not Extension — PASS**: The design uses two requested deployable applications and keeps domain, agent, provider, and workflow boundaries explicit; Redis remains deferred until evidence supports it.
- **II. Explicitness Over Magic — PASS**: Cross-service dependencies use versioned contracts and injected adapters. Zod and Pydantic validate every boundary; TypeScript `any`, implicit globals, and import-time side effects are prohibited.
- **III. Accessibility Is Correctness — PASS**: Every map operation has a non-map equivalent. Keyboard, focus-order, screen-reader, contrast, reduced-motion, and manual accessibility checks are acceptance gates.
- **IV. Context Is a Budget — PASS**: Stable instructions and tool schemas precede dynamic context; compact trip and conversation summaries are default, with explicit retrieval tools for omitted detail and measurements governing compaction.
- **V. Test Behavior, Not Implementation — PASS**: Tests target trip invariants, proposal outcomes, authorization boundaries, idempotency, provider failures, pricing disclosure, and accessible user journeys using deterministic doubles.
- **VI. Deliver in Small, Verifiable Increments — PASS**: The architecture supports vertical slices from setup through draft refinement before finalization and booking, each with independent contract and behavior checks.
- **VII. Make State Changes Explicit and Reversible — PASS**: The web domain layer owns a versioned trip aggregate. Agent output is a proposal; validation and application are separate commands, and each applied draft mutation records an inverse or disclosed non-reversible rule.
- **VIII. Treat Booking as a Transaction, Not a Conversation — PASS**: Booking capabilities are absent from conversational tools. Temporal starts only from explicit authorization bound to a revalidated offer set and records durable per-component outcomes with idempotency keys.
- **Trip State and Transaction Boundaries — PASS**: Proposed, draft, authorized, committed, failed, and cancelled states are modeled explicitly; material term changes invalidate authorization; sensitive values are minimized and redacted.

**Pre-Phase 0 gate result**: PASS. No constitutional violation requires an exception.

### Post-Design Re-evaluation

- **I. Optimize for Deletion, Not Extension — PASS**: [research.md](./research.md) rejects premature Redis, vector storage, event sourcing, extra services, and Python workflows. [data-model.md](./data-model.md) uses complete snapshots and a PostgreSQL outbox rather than speculative infrastructure.
- **II. Explicitness Over Magic — PASS**: [contracts/README.md](./contracts/README.md) assigns every cross-service contract an owner and compatibility rule. OpenAPI, JSON Schema, Zod, Pydantic, Kysely, and explicit SQL migrations make runtime and persistence boundaries reviewable.
- **III. Accessibility Is Correctness — PASS**: [quickstart.md](./quickstart.md) requires keyboard and screen-reader completion, map-equivalent controls, live-region behavior, reduced motion, zoom checks, and automated plus manual evidence.
- **IV. Context Is a Budget — PASS**: The context model fixes summary fields, recent-turn and retrieval bounds, a 70% compaction threshold, stable prompt prefixes, and authoritative-state precedence. Retrieval and telemetry are bounded and redacted.
- **V. Test Behavior, Not Implementation — PASS**: Quickstart scenarios prove estimate labeling, state convergence, stale proposal rejection, undo, authorization invalidation, duplicate prevention, unknown outcomes, partial failure, rescheduling isolation, and production price confidentiality.
- **VI. Deliver in Small, Verifiable Increments — PASS**: Public and internal contracts separate independently testable setup, draft editing, agent proposal, finalization, revalidation, authorization, booking, recovery, and rescheduling journeys.
- **VII. Make State Changes Explicit and Reversible — PASS**: The data model defines immutable trip snapshots, optimistic `expectedVersion` checks, typed draft operations, proposal state transitions, recorded initiating requests, and undo as a new version.
- **VIII. Treat Booking as a Transaction, Not a Conversation — PASS**: The agent tool schema intentionally omits transactional tools. Web API contracts require revalidation and exact terms hashes; the supply contract and booking state machines define durable idempotency, unknown outcomes, and explicit recovery.
- **Trip State and Transaction Boundaries — PASS**: Proposal, offer, authorization, transaction, and component states are distinct. Material changes invalidate authorization, customer projections exclude internal pricing, and sensitive data is prohibited from prompts and general telemetry.

**Post-Phase 1 gate result**: PASS. The design introduces no constitutional violation and requires no complexity exception.

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-trip-agent/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
```text
web/
├── app/
│   ├── (auth)/
│   ├── trips/
│   │   ├── new/
│   │   └── [tripId]/
│   └── api/
├── components/
│   ├── trip-setup/
│   ├── trip-workspace/
│   ├── map/
│   ├── agent/
│   └── booking/
├── domain/
│   ├── trip/
│   ├── pricing/
│   └── booking/
├── server/
│   ├── auth/
│   ├── db/
│   ├── agent-client/
│   ├── supply/
│   └── workflows/
├── workers/
│   └── booking/
└── tests/
    ├── unit/
    ├── integration/
    ├── contract/
    └── e2e/

agent/
├── src/onholidai_agent/
│   ├── api/
│   ├── graph/
│   ├── context/
│   ├── tools/
│   ├── integrations/
│   ├── models/
│   └── telemetry/
└── tests/
    ├── unit/
    ├── integration/
    ├── contract/
    └── evaluation/

contracts/
├── agent-api/
├── trip-domain/
├── supply/
└── events/

infra/
├── compose/
├── temporal/
└── observability/

.github/workflows/
```

**Structure Decision**: Use the requested `web/` and `agent/` applications as the only product services. The `web/` server owns authentication, authoritative trip commands, pricing disclosure, and booking initiation; the `agent/` service owns conversation orchestration, summaries, retrieval, and proposal generation. Root `contracts/` contains generated or language-neutral cross-service schemas, while `infra/` contains local orchestration and observability configuration. Booking workers are colocated with the TypeScript domain they execute; Python Temporal activities are limited to agent-owned long-running work when required by a concrete flow.
