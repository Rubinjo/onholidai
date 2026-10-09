/speckit-constitution

## 1. Optimize for Deletion, Not Extension
Modules MUST remain small enough to understand, replace, or delete independently. Reject speculative abstractions. Prefer simple implementations over premature generalization. Duplication below three occurrences is often cheaper than the wrong abstraction.

## 2. Explicitness Over Magic
Dependencies MUST be explicit, visible, and deliberate. Avoid hidden coupling, implicit global state, import-time side effects, and unnecessary singletons. Favor well-defined interfaces and dependency injection. Use precise types consistently across the codebase. TypeScript MUST NOT use `any`. Add inline type annotations to function signatures, API boundaries, and data structures whenever they improve clarity and maintainability.

## 3. Accessibility Is Correctness
Accessibility is a requirement, not polish. Interactive elements MUST support keyboard navigation, logical focus order, screen readers, and sufficient color contrast.

## 4. Context Is a Budget
Prompts, tool schemas, memory, and retrieved context MUST justify their token cost. Remove unused instructions and redundant context. Prefer stable prompt prefixes and isolate frequently changing content to improve cache efficiency where supported.

## 5. Test Behavior, Not Implementation
Tests MUST verify observable behavior, invariants, and failure modes rather than internal implementation details. External dependencies MUST be replaceable with deterministic test doubles. Critical paths require automated regression coverage.

## 6. Deliver in Small, Verifiable Increments
Changes MUST have clear acceptance criteria and remain independently testable. Run relevant checks before considering work complete.

## 7. Make State Changes Explicit and Reversible
The agent must operate on a structured, authoritative trip model rather than treating conversation history as the source of truth. Natural-language requests must translate into explicit, validated state changes.

## 8. Treat Booking as a Transaction, Not a Conversation
Conversational recommendations may update a draft itinerary, but bookings, payments, and other externally consequential actions require explicit authorization and controlled execution.