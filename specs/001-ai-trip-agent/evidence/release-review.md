# Phase 7 release review

Review basis: project constitution v1.0.1, feature specification, task plan, and current implementation. This is a code and artifact review only; automated checks and human acceptance were not run.

## Review findings

- Trip writes continue through the versioned transaction boundary. Historical versions and audit events remain append-only; booking authorization is bound to exact terms and transaction execution basis.
- Conversation messages have a 90-day expiry and expired messages are excluded from history reads. The new 24-month trip activity review preserves transaction evidence by default and requires an explicit configured business policy before deletion is authorized.
- Legal holds are represented as active/released records and placement/release is restricted to administrators with immutable audit events.
- Export scopes are checked against the owner or an authorized internal role. Owners may export unexpired redacted conversation content; internal exports cannot request that scope.
- Legacy snapshot decoding allows a missing departure origin to remain readable and exposes `requiresDepartureOrigin` for callers. Automated compatibility additions were authored but not executed.
- Prompt content is bounded and telemetry redaction is allowlist-based. Actual token measurements and end-to-end trace inspection remain pending.
- Existing focus, live-region, reduced-motion, and map/list fallback support is present. Latest browser versions and manual assistive-technology journeys remain unverified.

## Deferred work and owners

| Work                                                                                                 | Owner                              | Exit evidence                                                                       |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| Run T108–T109 privacy and compatibility suites against isolated PostgreSQL and both language stacks  | Release engineer (assign)          | Passing run IDs and migration history review                                        |
| Run 100-session, 5,000 requests/hour and 20 booking starts/minute capacity scenarios                 | Performance owner (assign)         | p95 results, resource profile, build/configuration and denominator                  |
| Measure token budget and inspect redacted cross-service traces                                       | Agent/observability owner (assign) | `evidence/context-telemetry.md` completed with synthetic trace IDs and measurements |
| Complete current-browser and keyboard/screen-reader journeys                                         | Accessibility owner (assign)       | `evidence/accessibility.md` completed, including SC-012 results                     |
| Execute quickstart, Scenarios 1–9, and fixed acceptance cohorts                                      | Product/release owner (assign)     | `evidence/acceptance.md` completed with failure-inclusive results                   |
| Confirm retention/deletion policy, commercial provider access, and jurisdiction-specific disclosures | Legal/business owner (assign)      | Approved policy identifiers, scope, and review date                                 |

## Decision

Do not claim release acceptance. The code changes in Phase 7 can be reviewed, but task gates requiring measured capacity, browser evidence, participant results, provider access, or business/legal policy remain open.

## Phase 7/8 automated closure pass (2026-10-14)

This pass completed the automatable Phase 7 and convergence tasks that did not require manual human review:

- Compatibility (T109/T155): `web/tests/integration/migration-compatibility.test.ts` plus an extended `agent/tests/contract/test_schema_compatibility.py`; `pnpm test:contracts` passes (web contracts 60, agent contracts 39).
- Context/telemetry review (T111/T159): measured compaction, stable-prefix and retrieval evidence in `agent/tests/evaluation/test_context_budget.py` and `evidence/context-telemetry.md`; live trace inspection still needs credentials.
- Evaluation corpus (T128): corpus repair to 1.4.0; see `evidence/us3.md`.
- Deployment configuration (T129): `web/tests/unit/config.test.ts` proves the production/live requirements and the browser boundary.
- Telemetry (T130): explicit OTLP startup wiring, sanitized span/event names, allowlisted attributes, per-request emission at the `apiResponse` boundary, and sink/collector-drift tests.
- Outbox (T131): event-envelope/version validation, a PostgreSQL consumer receipt store, and type-scoped claiming with restart/duplicate/expired-lease/unknown-type tests.
- Privacy retention (T154) and documentation (T160) verified.

Deferred rows still requiring a human or a rebuilt stack: capacity measurements (T110/T156), cross-browser and assistive-technology journeys (T112/T157), quickstart scenarios and participant cohorts (T114/T158), the US1/US3/US4 story checkpoints (T136/T138/T143, T085/T107), and business/legal policy confirmation.
