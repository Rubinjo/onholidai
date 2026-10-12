# Phase 0 Research: AI Trip Planning Agent

**Date**: 2026-10-09  
**Feature**: [AI Trip Planning Agent](./spec.md)

## Runtime and Workspace Baselines

**Decision**: Use Node.js 24 LTS for the Next.js application and TypeScript workers, Python 3.13 for the FastAPI/LangGraph service, pnpm 10 for JavaScript workspaces, and uv for Python dependency management. Commit lockfiles and pin mutually compatible stable framework, SDK, action, and image versions during implementation.

**Rationale**: LTS and mature interpreter baselines reduce compatibility risk while pnpm and uv provide deterministic cross-language workspace installs. Exact library versions must be selected as a tested compatibility set rather than assumed from independent latest releases.

**Alternatives considered**: Node.js 22 and Python 3.12 are conservative fallbacks if required SDKs do not support the preferred baselines. Non-LTS Node releases, an unverified newest Python release, floating dependency versions, and a single cross-language package manager were rejected.

## Browser, Local Development, and CI Baselines

**Decision**: Support the latest two stable Chrome, Edge, Firefox, and Safari releases, corresponding mobile browsers, and Firefox ESR. Use Docker Compose v2 for local development and GitHub Actions on `ubuntu-24.04` with lockfile-enforced installs and pinned third-party actions.

**Rationale**: The finite browser policy is testable and covers meaningful MapLibre, date-control, authentication, and responsive-layout differences. Compose provides the requested reproducible local stack without introducing production orchestration assumptions.

**Alternatives considered**: Chromium-only testing is inadequate for a consumer web product. Internet Explorer and obsolete browsers are excluded. Kubernetes for local development and floating `latest` images or CI runners were rejected as unnecessary or non-reproducible.

## Database Ownership and Access

**Decision**: The `web/` service exclusively owns application tables and authoritative trip writes. It uses Kysely with the PostgreSQL `pg` driver and repository-owned numbered SQL migrations. The Python agent has no direct application-table credentials and uses versioned internal APIs.

**Rationale**: Typed SQL keeps PostgreSQL transactions, constraints, JSONB, and PostGIS operations explicit while avoiding a heavy ORM. One write owner prevents domain-rule drift and agent-side mutation races. A controlled migration job uses expand/migrate/contract changes before a new application version serves traffic.

**Alternatives considered**: Prisma obscures advanced PostGIS and SQL behavior; Drizzle is viable but adds schema abstraction without a clear benefit here. Shared table access from Python, independent Alembic migrations, and separate databases were rejected for the initial scope.

## Geospatial Persistence

**Decision**: Enable PostGIS explicitly. Store place coordinates as SRID 4326 geography points, route shapes in the appropriate SRID 4326 line type, and add GiST indexes. Encapsulate recurring spatial expressions in small typed query helpers.

**Rationale**: PostGIS provides correct distance, containment, and proximity semantics and supports map and itinerary queries without a separate geospatial service.

**Alternatives considered**: Loose latitude/longitude columns are suitable only for a display prototype and do not satisfy spatial-query requirements. A standalone geospatial service is premature.

## Trip Versions, Concurrency, and Events

**Decision**: Store trip identity and `current_version` in `trips`, with immutable complete aggregate snapshots in `trip_versions`. Every mutation supplies `expectedVersion`; one database transaction inserts the new version and conditionally advances the current version. Undo creates another version from a prior snapshot. Commit domain events to a PostgreSQL outbox in the same transaction.

**Rationale**: Snapshots make current reads, audit, comparison, and restoration simple. Optimistic concurrency prevents lost updates without distributed locks. The outbox prevents committed state from diverging from asynchronous work.

**Alternatives considered**: Full event sourcing is not justified. Mutable current-state-only rows cannot support reliable inspection and undo. Last-write-wins, pessimistic trip locks, and direct publish inside a request were rejected.

## Service Topology and Authentication

**Decision**: Next.js is the browser-facing backend-for-frontend. Better Auth validates the browser session and trip ownership. Internal calls to FastAPI use a short-lived service credential plus explicit actor context containing user, trip, request, base trip version, and allowed scope.

**Rationale**: The browser has one authenticated application boundary; raw session cookies do not cross services. FastAPI receives enough context to authorize agent work without becoming the customer-session authority.

**Alternatives considered**: Direct browser-to-FastAPI calls and forwarding Better Auth cookies broaden exposure and coupling. Passing only a user identifier omits trip and concurrency context.

## Request, Streaming, and Contract Pattern

**Decision**: Use JSON request/response for durable reads and commands. Web reserves runs before dispatch; the agent persists scoped events/results through the callback contract in contracts/web-api.openapi.yaml before exposing SSE or final status. Receipts deduplicate run/cursor and request fingerprints; gaps/conflicts reject atomically. Progress renews a 90-second lease every 15 seconds; interrupted queued/running runs become failed; clarification suspends the lease until resume, and explicit retries start new research requests. Pydantic models produce versioned OpenAPI/JSON Schema artifacts; generated TypeScript types and Zod validators consume them and both services run contract tests.

**Rationale**: Commands retain clear retry, status, and concurrency semantics while the user receives progressive agent feedback. SSE fits one-way events and standard web infrastructure better than a bidirectional socket. Generated runtime validation prevents cross-language drift.

**Alternatives considered**: Streaming every operation complicates retries and caching. WebSockets add lifecycle complexity without a bidirectional requirement. Hand-maintained duplicate TypeScript and Python models were rejected.

## Proposal Validation and Application

**Decision**: Trip-domain LangGraph tools are `get_trip`, `propose_trip_changes`, and `retrieve_relevant_context`; separate research tools remain read-only. Every agent change, including an initial estimate, is a structured proposal with purpose, initiating request and base trip version. A traveller-confirmed city/airport origin is mandatory for flight estimation; return defaults to that origin. US1 owns the common proposal/acceptance primitives, with US2 extending refinement and history. Only explicit UI acceptance lets web validate, price and apply operations. Version mismatch returns a conflict and never merges silently.

**Rationale**: Conversation remains advisory, the trip aggregate remains authoritative, and every accepted draft change is inspectable and reversible. Focused clarification is reserved for materially ambiguous requests.

**Alternatives considered**: A generic agent `update_trip` tool, silent proposal application, client-only validation, and last-write-wins merging violate the state boundary.

## MCP and Travel Supply Boundaries

**Decision**: Google Maps Grounding Lite and Tavily are read-only agent tools. The first-party `travel-supply` layer exposes separate read/search and restricted transaction interfaces across Duffel, Booking.com, GetYourGuide, and Trainline. LangGraph may use search operations but cannot access booking, payment, cancellation, or rescheduling operations.

**Rationale**: Normalization centralizes provider capabilities and terms while hard separation prevents conversational text from becoming transaction authorization.

**Alternatives considered**: Direct provider calls from the agent or workflows duplicate provider policy and weaken authorization. Supplying an authorization flag to an LLM booking tool was rejected.

## Conversation Context Management

**Decision**: Persist complete conversation messages, structured summaries, and retrieval metadata in PostgreSQL while raw messages are within retention. Prompt context contains stable instructions and tools first, then a compact trip snapshot, summary fields (`constraints`, `preferences`, `decisions`, `rejected_options`, `open_questions`), approximately the most recent 20 turns or 8,000 tokens, and narrowly retrieved history. Compact at 70% of the model context budget or after 100 turns.

**Rationale**: The policy uses recent conversational evidence without allowing history to replace authoritative state. Retrieval can recover omitted decisions while preserving prompt-cache-friendly stable prefixes.

**Alternatives considered**: Sending full history increases latency, cost, and contradictions. Vector-only retrieval can miss authoritative facts; PostgreSQL metadata and full-text retrieval are sufficient until quality measurements justify more infrastructure.

## Temporal Ownership and Authorization Snapshot

**Decision**: TypeScript workers in `web/` own revalidation, booking, rescheduling and recovery. Revalidation snapshots exact components, offer IDs, origin, travellers, dates, prices/taxes/fees, cancellation terms, currency and expiry. Authorization requires the current version at start and first write; consuming it creates an immutable execution basis. Further writes validate that basis, expiry and a provenance-checked chain of same-transaction status/evidence versions. Changed material facts or external versions stop pending writes. Durable write claims serialize dispatch with material edits; unknown outcomes are reconciled before releasing claims.

**Rationale**: Booking ownership stays with the authenticated trip and pricing domain. Any material change invalidates the authorization. Python Temporal workflows are deferred until an agent-owned process has durable waits or long retries.

**Alternatives considered**: Python-owned booking and mixed-language workflow implementations split ownership. Putting every short agent run into Temporal adds overhead without a current durability need.

## Booking Saga, Idempotency, and Recovery

**Decision**: Book components as a durable saga with per-component states: proposed, authorized, booking, confirmed, failed, unknown, cancelled, or action-required. Persist transaction and component idempotency keys in PostgreSQL. Automatically retry only idempotent reads or writes using the exact provider-supported key; after ambiguous timeouts, query provider status before any retry. Preserve successful components and require authorization before compensating cancellation.

**Rationale**: Independent providers cannot participate in an atomic transaction. Unknown outcomes must be reconciled rather than guessed, and durable keys prevent duplicate external actions during retries or workflow replay.

**Alternatives considered**: Synchronous all-or-nothing booking, blind activity retries, Redis-only idempotency, and automatic rollback of successful reservations were rejected as unsafe.

## Component Rescheduling

**Decision**: Reschedule one component through a separate workflow that revalidates it and directly dependent segments, collects fresh authorization for exact new terms, and records old and new references. Unaffected confirmed components remain unchanged.

**Rationale**: Rescheduling is consequential and provider-specific; isolating it prevents a broad trip edit from silently changing existing reservations.

**Alternatives considered**: Treating rescheduling as a normal draft edit or rebuilding the whole booking creates unnecessary risk and scope.

## Initial Scale, Limits, and Retention

**Decision**: Target 10,000 registered users, 1,000 daily active users, 100 concurrent planning sessions, 5,000 estimate/refinement requests per hour, and 20 booking starts per minute. Limit an initial trip to 10 travellers, 8 destinations, and 32 components. Retain active trips, booking outcomes, authorizations, and audit records for 24 months after last activity; retain raw conversation content for 90 days and structured summaries with the trip, subject to legal requirements and user deletion/export rights.

**Rationale**: These limits are sufficient to expose real provider and workflow behavior without requiring speculative sharding or caching. Shorter raw-conversation retention reduces privacy exposure.

**Alternatives considered**: Designing for millions of users creates premature infrastructure. Indefinite raw conversation retention increases risk without demonstrated value.

## Performance Budgets

**Decision**: Set p95 budgets of 300 ms for direct trip reads/edits excluding provider calls, 2 seconds for accepted version propagation and initial agent progress, 30 seconds for initial estimates, 8 seconds for offer search, 10 seconds for revalidation summaries, 500 ms for booking workflow acknowledgement, and 5 seconds for the first component status. Booking remains asynchronous with a 2-minute target, not a synchronous timeout guarantee.

**Rationale**: The budgets connect the specification's user outcomes to measurable service and workflow behavior while recognizing provider latency.

**Alternatives considered**: One global latency target cannot distinguish local domain behavior from external supplier work. Synchronous booking cannot communicate durable partial outcomes reliably.

## Telemetry, Tracing, and Evaluation

**Decision**: Correlate OpenTelemetry traces across web, agent, Temporal, and provider adapters with allowlisted attributes. Disable raw production prompt and response capture by default. Apply the same redaction before LangSmith ingestion; use synthetic fixtures for evaluations and keyed hashes only where identifier correlation is required.

**Rationale**: Outcome class, latency, retries, provider, trip/workflow identifiers, and error category are operationally useful without exposing payment data, traveller details, precise personal constraints, credentials, supplier cost, or margin.

**Alternatives considered**: Capture-then-scrub creates avoidable sensitive copies and depends on perfect field detection. Unredacted production LangSmith traces were rejected.

## Clarification Follow-through (2026-10-10)

**Decision**: Follow spec.md's feasibility/evaluation/usability policy v1 and the per-story gates in plan.md. Freeze deterministic corpora and expectations before user-story implementation; distinguish simulated from live-provider results and actual usability evidence. Setup starts the infrastructure profile and service shells, foundation adds migrations, and US4 adds the booking worker. Earlier increments never depend on later operational capabilities.

**Rationale**: These decisions resolve analysis I1–I3, U1–U3 and A1–A2 without adding product services or weakening exact-term authorization.

## Redis Introduction Rule

**Decision**: Do not require Redis initially. Introduce it only for a measured hot-read cache, distributed rate limit, ephemeral coordination requirement, or demonstrated throughput bottleneck with an explicit invalidation and fallback policy.

**Rationale**: PostgreSQL already supplies durable state, concurrency, outbox delivery, and idempotency. Deferral follows the project's deletion-first principle.

**Alternatives considered**: Redis as trip truth, session truth, conversation truth, or durable idempotency storage weakens auditability and adds consistency work.
