<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.0.1
- Modified principles:
- IV. Context Is a Budget: clarified explicit context-caching considerations
- Added principles: None
- Added sections: None
- Removed sections: None
- Follow-up TODOs: None
-->
# Onholidai Constitution

## Core Principles

### I. Optimize for Deletion, Not Extension
Modules MUST remain small enough to understand, replace, or delete independently. Contributors MUST
reject speculative abstractions and prefer the simplest implementation that satisfies current
acceptance criteria. Duplication below three occurrences MAY remain when extracting it would create
an unproven abstraction. This keeps change costs bounded and prevents unused flexibility from
becoming permanent maintenance work.

### II. Explicitness Over Magic
Dependencies MUST be explicit, visible, and deliberate. Code MUST avoid hidden coupling, implicit
global state, import-time side effects, and unnecessary singletons; well-defined interfaces and
dependency injection MUST be used where a dependency crosses a module boundary. Precise types MUST
be used consistently. TypeScript MUST NOT use `any`, and function signatures, API boundaries, and
data structures MUST include inline type annotations when they improve clarity or maintainability.
These constraints make behavior traceable and contracts reviewable.

### III. Accessibility Is Correctness
Accessibility MUST be part of acceptance criteria for every user-facing change. Interactive
elements MUST support keyboard operation, logical focus order, screen readers, and sufficient color
contrast. Relevant automated checks and manual keyboard verification MUST pass before completion.
An interaction that excludes users is functionally incorrect, not merely unfinished polish.

### IV. Context Is a Budget
Prompts, tool schemas, memory, and retrieved context MUST justify their token cost. Unused
instructions and redundant context MUST be removed. Context design MUST account for context caching:
stable prompt prefixes MUST be preferred, while frequently changing content MUST be isolated to
maximize cache reuse where the platform supports it. Changes to prompt ordering or shared context
MUST consider cache invalidation and its cost. Context changes MUST be reviewed for behavioral value,
token impact, and cache efficiency because excess or unstable context reduces capacity for
task-relevant evidence.

### V. Test Behavior, Not Implementation
Tests MUST verify observable behavior, invariants, and failure modes rather than private structure
or call sequences. External dependencies MUST be replaceable with deterministic test doubles.
Critical paths, including trip state transitions and consequential actions, MUST have automated
regression coverage. This preserves refactorability while proving the contracts users depend on.

### VI. Deliver in Small, Verifiable Increments
Every change MUST have explicit acceptance criteria, remain independently testable, and be scoped to
the smallest coherent increment. Relevant tests, type checks, lint checks, and accessibility checks
MUST run before the work is declared complete. Failures MUST be resolved or documented as an
explicitly accepted exception. Small verified increments limit risk and make review evidence clear.

### VII. Make State Changes Explicit and Reversible
The agent MUST operate on a structured, authoritative trip model; conversation history MUST NOT be
treated as the source of truth. Natural-language requests MUST translate into explicit, validated
state-change proposals before mutating that model. Each mutation MUST record enough information to
inspect its effect and reverse it unless reversal is impossible by domain rule. This prevents
ambiguous conversation from silently corrupting itinerary state.

### VIII. Treat Booking as a Transaction, Not a Conversation
Conversational recommendations MAY update a draft itinerary, but bookings, payments, cancellations,
and other externally consequential actions MUST require explicit user authorization for the exact
action and material terms. Execution MUST use a controlled transaction boundary with validation,
idempotency or duplicate prevention, durable outcome recording, and clear failure handling. A chat
message alone MUST NOT be interpreted as authorization to commit an external action.

## Trip State and Transaction Boundaries

The authoritative trip model MUST distinguish proposed, draft, authorized, committed, failed, and
cancelled states where applicable. State transitions MUST validate inputs and permissions, identify
the initiating request, and produce an auditable result. Draft updates MUST NOT invoke booking or
payment side effects. Authorization MUST be bound to the current terms; any material change to
price, dates, travelers, inventory, or cancellation policy MUST invalidate prior authorization and
require renewed confirmation.

Sensitive payment and traveler data MUST be minimized, passed only to required dependencies, and
excluded from prompts, logs, and test fixtures unless represented by approved redacted or synthetic
values. Transaction retries MUST be safe against duplicate external actions. When an action cannot
be reversed, the interface MUST disclose that fact before authorization.

## Development Workflow and Quality Gates

Work MUST begin with testable acceptance criteria and an identified authoritative data boundary.
Implementation MUST proceed in small increments, with each increment reviewed for unnecessary
abstraction, hidden dependencies, context cost, accessibility, and transaction risk. Reviewers MUST
require evidence from the checks relevant to the changed behavior and MUST reject unexplained use of
exceptions to these principles.

Tests MUST cover successful behavior, validation failures, and consequential-action safeguards at
the appropriate unit or integration boundary. Changes to trip state schemas or transaction contracts
MUST include migration or compatibility handling. A change is complete only when its acceptance
criteria pass and any remaining risk or deferred work is recorded explicitly.

## Governance

This constitution is the highest-priority project governance document. Conflicting local practices,
plans, and review conventions MUST yield to it. Amendments MUST be proposed as a documented change
that states the motivation, compatibility impact, migration needs, and affected principles. An
amendment requires maintainer approval and MUST update the Sync Impact Report, version, and amendment
date before adoption.

Constitution versions follow semantic versioning. A MAJOR version removes or incompatibly redefines
governance or a principle; a MINOR version adds a principle or materially expands required guidance;
a PATCH version clarifies wording without changing obligations. Compliance MUST be reviewed during
planning and code review, and releases MUST NOT proceed with an unresolved constitutional violation
unless an approved, time-bounded exception documents its owner, rationale, risk, and expiry date.

**Version**: 1.0.1 | **Ratified**: 2026-10-09 | **Last Amended**: 2026-10-09
