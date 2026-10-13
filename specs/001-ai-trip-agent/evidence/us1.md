# US1 implementation and validation evidence

Date: 2026-10-12. Implementation is recorded; the US1 acceptance checkpoint remains incomplete.

## Implemented journey

T019–T045 and T120–T124/T132–T135 cover authenticated setup, confirmed origin/resolved destinations, preferred/flexible windows, duration, party/ages, all five style controls, reviewable requirements, persisted research, clarification/retry, trusted estimate review and explicit acceptance. Inputs survive invalid submissions. Optional MapLibre diagrams have an ordered list equivalent and outage feedback. Booking remains visibly unavailable.

Research never applies a proposal. Web reserves an owned, fingerprinted run before dispatch. Generated validators guard requests/results/events. Additive migration 005 persists immutable receipts, clarification fingerprints, query-bound quote records and full private candidates; existing migrations 001–004 are unchanged. Callback authorization precedes state access. Exact retries reuse receipts; gaps, changed fingerprints, premature results and identity mismatches fail closed. Progress renews a 90-second lease; scoped status reads durably mark overdue runs interrupted. Clarification suspends the lease, and verified resume does not restart historical work.

LangGraph fetches authoritative state through scoped reads. Stable instructions precede minimized dynamic context; internal costs and sensitive strings are excluded from model input, and implicit raw LangSmith tracing is disabled. Injected model/research/supply clients are read-only and deadline-bounded. The flow prefers ideal duration, preserves availability/duration preferences, allocates nights, discloses unresolved requirements and compares flexible dates without silently switching them. Comparable quote groups are selected rather than summing alternatives. Missing essential transport/stay evidence fails rather than presenting an empty estimate as complete.

Web reconstructs every component and monetary fact from its own quote records, matching origin, party, currency, route and dates. Public previews omit supplier/margin facts. The illustrative range is disclosed as 90–120% of planning prices, not a supplier guarantee. Acceptance requires a fully persisted matching result, current version and unexpired proposal/offers. The sole trip commit shares a transaction with proposal transitions and records a full-snapshot inverse. Exact concurrent acceptance retries cannot create another version. Reload restores committed state and stored rationale.

## Executed checks

Python's existing environment and the Node 24.21.0 runtime supplied by Python tooling were used. Node/pnpm are not normally on PATH. A frozen pnpm 10.18.3 workspace install succeeded (695 packages), without upgrading dependencies.

- Python pytest: **42 passed**; Ruff and strict Pyright pass. An alternative-quote regression was observed failing before its fix.
- Web TypeScript and ESLint pass. Vitest: **107 passed, 37 PostgreSQL-dependent tests skipped**.
- Next.js production build passes with build-only credentials. A setup-page prerender failure was fixed with explicit dynamic rendering; Node startup is separated from Edge instrumentation.
- Producer export/drift, TypeScript/Zod reproduction and all 36 shared wire cases, OpenAPI reference/promotion, snapshot and corpus drift checks pass.
- Privacy regressions exercise JSON/cache input, rendered estimate HTML, priced public SSE envelopes, role-restricted diagnostics and allowlisted telemetry with distinct synthetic supplier/margin sentinels.

The required CI foundation gate includes reservation/identity, cursor/fingerprint gaps, result-before-event, lease interruption, pricing without mutation, complete-result acceptance, concurrent replay, ownership, stale conflicts and migration compatibility. These PostgreSQL behaviors remain unexecuted locally; skipped tests are not passing evidence.

## Frozen estimate evaluation — limited scope

Corpus **1.1.0**, policy **1**, seed `onholidai-evaluation-v1-seed-20261011`.
Hash: `sha256:4d6699c4d0288a462e6e65b47c952dc8fc871421e856294be4fb7473f6c41c8e`.

`pytest agent/tests/evaluation/test_estimates.py -q -s` runs the actual graph against 100 executable synthetic inputs with deterministic research doubles: **100/100 proposals within 30 seconds and 100/100 requirement disclosures**, observed graph-only p95 approximately **2.5 ms**. Failures are retained in the denominator.

This is not BFF/database/browser latency, verified feasibility, live-provider/model performance or usability evidence. T128's refinement/itinerary placeholders remain unscored and need repair. Revisions require a recorded reason and fresh evaluation.

## Outstanding acceptance gates

- Run all 37 PostgreSQL checks with isolated admin/migration/application/worker URLs and Docker/PostGIS. T116–T119 retain their deferred database markers.
- Run authenticated US1 Playwright setup/review/acceptance/reload and outage journeys across desktop/mobile engines. Provide `US1_STORAGE_STATE` for a synthetic account and keep `PLAYWRIGHT_BASE_URL` equal to `BETTER_AUTH_URL`.
- Perform actual keyboard, screen-reader, zoom and reduced-motion checks; no manual assistive-technology evidence was invented.
- Measure failure-inclusive end-to-end first progress, search and proposal visibility. Safe database audit records support these timings, excluding only clarification wait.
- Execute the specified fixed cohort of at least 20 leisure travellers, including assistive-technology, family and multi-destination groups. No participant outcomes or eight-minute setup success rate were fabricated.

**T046/T136 remain unchecked. This is not a completed acceptance checkpoint.**

## Runtime and live limitations

Run US1 with infrastructure, migrations and applications profiles, not the unimplemented booking worker. Compose shares `service_token_secret.txt` between web and agent and passes `WEB_BASE_URL=http://web:3000`. The independent pricing diagnostic key stays web-only. Build credentials are not runtime secrets.

Default offers/places are synthetic and visibly labelled. Duffel/Booking.com/GetYourGuide/Trainline adapters accept injected normalized read clients; commercial SDK/HTTP access is not demonstrated. Live mode never silently uses synthetic offers; live place lookup requires an injected provider. Bounded Nebius/Maps Grounding Lite/Tavily transports are implemented, but no paid/live calls were made. Formats were checked against [Nebius](https://api.studio.nebius.com/docs), [Google MCP](https://developers.google.com/maps/ai/grounding-lite/reference/mcp) and [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search).
