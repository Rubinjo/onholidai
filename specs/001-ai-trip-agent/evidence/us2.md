# User Story 2 implementation evidence

Date: 2026-10-13. Status: implemented core behavior; full story acceptance remains open.

## Delivered behavior

Reviewed direct edits and conversational refinements create immutable draft versions through the existing authoritative commit primitive. Stored impact fingerprints bind the exact base version, operations, candidate and customer-facing review. Stale/expired edits and protected booking state are rejected. Undo restores prior draft content as a new version. Replays use stored receipts rather than repeating mutations.

Refinement proposals are independently validated and repriced by web-owned read-only supply adapters. Route/date/party/style/constraint changes expose transport, stays, activities, availability, price and unresolved verification impacts before acceptance. Changed planning inputs clear superseded daily recommendations; full day-plan regeneration and verified feasibility remain US3 responsibilities. Missing essential offers fail closed.

The responsive workspace shares one TanStack Query TripEnvelope. Committed outbox events invalidate it; one-second polling preserves convergence when events are unavailable. Older reads cannot overwrite newer cached versions. External edits preserve unsaved inputs with an explicit conflict. Conversation/history reload, proposal acceptance/rejection, focused clarification and draft undo have dedicated UI controls. Booking remains unavailable.

The geographic map includes vendored Natural Earth country outlines, selected countries, ordered places and committed sourced segment geometry. The route list provides equivalent information and remains available on map failure. Dataset attribution/hash are in `web/public/maps/ATTRIBUTION.md`.

## Executed evidence

- Web regression suite: 114 passed, 39 database-dependent tests skipped. Skipped tests are not passes.
- Agent suite: 60 passed. Ruff and Pyright passed.
- Web TypeScript and ESLint passed. Next.js production build passed using the repository's build-only credentials.
- Agent exporter, generated TypeScript/Zod, snapshot generation, promoted/source API references and corpus drift checks passed.
- Corpus 1.2.0, policy 1, seed `onholidai-evaluation-v1-seed-20261011`, hash `sha256:60972ec6d38367e27759150aed41dd27e26f43300153c87248d4483094e969a3`.
- Frozen refinement scoring: 100/100 exact predetermined operations, with 20 requests per specified group and zero unnecessary clarifications. Separate ambiguity scoring: 20/20 focused clarifications. The same 100 operations passed trusted web repricing and complete snapshot validation, preserving existing required constraints and integer customer totals.
- Synthetic context tests preserve structured evidence across 120 messages, bound recent history to 20 messages/8,000 conservative tokens, and recover uniquely referenced rejected destinations through scoped retrieval. Missing/multiple references ask one question.
- A rendered workspace regression measured all committed panes converging within two seconds under polling with events unavailable; subsequent older reads did not regress the cache. This is component-level evidence, not a full-stack latency measurement.
- Browser scenarios are authored for two-session stale conflicts, clarification, rejection, history/undo/reload, map failure, reduced motion, mobile/zoom and keyboard order. Discovery found 10 cases across Chromium, Firefox, WebKit and mobile projects; authenticated execution is pending.

## Configuration and privacy

Nebius uses `https://api.tokenfactory.nebius.com/v1`. Live agent operation requires real research keys and an explicit Token Factory model ID. Planning supply adapters remain deterministic by default; commercial provider access is not demonstrated by synthetic results.

`.env.example` and agent settings include `LANGSMITH_TRACING`, the EU endpoint, API key, agent ID `onholidai`, and environment `local`. Compose forwards these settings to agent. The exporter addresses that agent/environment and emits only fixed names and validated outcome/duration metadata. Automatic prompt/response/graph-state tracing remains disabled; synthetic sink tests prove inputs are empty and arbitrary purpose/outcome values cannot be exported. Real LangSmith ingestion and real Nebius calls were not exercised.

## Open acceptance gates

- Provision the four isolated test database URLs and run SQL migration compatibility, scoped history/proposal APIs, concurrent edit/acceptance, receipt replay and undo tests. Migration 007 is added, not applied to a live database in this session.
- Start the migrated deterministic application stack; provide `US1_STORAGE_STATE` and `US2_TRIP_ID` for a seeded Tokyo/Kyoto estimate with room for extra nights. Execute browser scenarios and inspect full-stack SSE reconnect and two-second convergence.
- Complete actual keyboard/screen-reader and zoom/reduced-motion/map-outage review. Component tests and browser discovery do not establish manual accessibility acceptance.
- Run SC-006 with the required fixed 20-person cohort. No participant results were fabricated or inferred from automated tests.
- T128 remains partially open: refinement placeholders were repaired with documented reason and new frozen expectations, while US3 itinerary/hard-conflict placeholders are unchanged and are not scored as evidence.

T068/T069/T138 remain open for the missing integration, manual and participant evidence. This file does not declare production acceptance.
