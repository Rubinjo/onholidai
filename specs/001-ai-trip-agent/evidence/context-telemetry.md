# Context and telemetry review

Status: harness implemented and synthetic measurements recorded. Every number below was produced by running `agent/tests/evaluation/test_context_budget.py` on 2026-10-14 with synthetic data only and no credentials; nothing is transcribed from documentation or invented. Live web→agent→workflow→provider trace inspection and any OpenTelemetry attribute export remain open (see below).

## Synthetic measurement record

Command: `cd agent; uv run pytest tests/evaluation/test_context_budget.py -q -s --basetemp="..\.pytest-tmp"` (all deterministic and credential-free; provider mode `deterministic`, synthetic provider doubles only).

Representative 120-turn conversation (`maximumTokens=24000`):

- raw conversation: **48,000 UTF-8 bytes** across 120 messages (`"x" * 400` each);
- retained after compaction: **8,000 UTF-8 bytes** across the latest **20 messages** (bound `min(8000, maximumTokens/3)`);
- compaction triggered (`compacted=True`) by the `>=100 messages` rule;
- stable system/tool prefix: **406 UTF-8 bytes**, byte-identical across an unchanged request vs a changed trip version (`changed[0] == unchanged[0]`), while the dynamic section differs, so the equality is not vacuous;
- assembled prompt (prefix + dynamic): **10,672 UTF-8 bytes**; dynamic section **10,266 UTF-8 bytes**, within the enforced `min(32768, maximumTokens*2)` bound;
- estimated input tokens: **2,668** using a 4-bytes-per-token heuristic; **10,672** using the code's stricter 1-byte-per-token conservative bound. Both are below the 24,000 configured budget.

Compaction threshold (documented as 70% of `maximumTokens`): with `maximumTokens=1000`, 6×100-byte messages stay uncompacted while 7×100-byte messages compact; 100 messages of 1 byte compact on the message-count rule even at a large budget.

Retrieval value: `retrieve_relevant_context` rejects a request lacking `context:read` (`missing_context_scope`) and a response with more than `limit` items (`context_response_exceeded`), and returns provenance unchanged (`source=rejected_proposal`, `sourceTripVersion=1`, `authoritative=False` all retained). In the composition path a retrieved historical destination cannot override authoritative current state: the current trip is not mutated, and stale historical dates/nights are recomputed to `arrivalDate=null`, `departureDate=null`, `plannedNights=0` before any proposal is emitted.

## Trace privacy review

No live or remote trace was available in this pass (no LangSmith/OpenTelemetry credentials and `provider_mode=deterministic`), so **no real web→agent→workflow→provider trace is claimed as inspected**. What was inspected instead is the synthetic path exercised through `httpx.MockTransport` doubles (`https://synthetic.invalid`): web `WebRunStore` dispatch → agent graph (`estimate`/`refine`) → deterministic provider (`NebiusClient(DeterministicModel)`, Tavily/Maps doubles). Raw prompts and traveller facts cannot enter a trace because tracing is disabled around the graph (`langsmith.tracing_context(enabled=False)`) and the only exporter is the allowlisted sink below, which drops input/output bodies entirely.

## Redaction allowlist proof

`SafeLangSmithSink.emit` is the only export path. Exercising it with synthetic values shows LangSmith receives exactly one run object with the keys `name, inputs, run_type, id, address, start_time, end_time, outputs, extra`, where:

- `name` = `onholidai.planning`;
- `inputs` = `{}` (always empty — no prompt, context, message or traveller data);
- `outputs` = `{purpose, outcome, duration_ms}` only (synthetic example `{"purpose": "refinement", "outcome": "proposal", "duration_ms": 12.5}`);
- `extra.metadata` = `{agent_id, agent_environment}` only;
- `id`, `address`, `start_time`, `end_time` are transport/correlation metadata.

`emit` drops any `purpose` outside `{initial_estimate, refinement}` and any `outcome` outside `{proposal, clarification, answer, failed}`, so `emit("raw traveller prompt", ...)` and `emit("refinement", "supplier margin", ...)` produce no run at all. Pre-ingestion redaction (`redact_for_langsmith`, production) additionally maps `inputs/outputs/prompt/content/response/...` keys and sensitive key parts (supplier, margin, passport, payment, secret, credential, traveller contact/identity) to `[REDACTED]`.

OpenTelemetry: the web BFF now emits one sanitized span per API request through `web/server/telemetry-exporter.ts` (allowlisted span/event names and attributes, OTLP/HTTP export only when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured, wired at startup and proven by sink and collector-drift tests). The agent process does not emit OTel spans; it exports to LangSmith only. No live OTLP collector was run in this pass, so no exported-span sample is claimed as inspected.

## Current implementation evidence

- Agent context starts with a fixed `STABLE_INSTRUCTIONS` prefix and a fixed allowlist of read-only tools (`get_trip`, `research`, `propose_trip_changes`, `retrieve_relevant_context`).
- Context compaction keeps structured constraints, preferences, decisions, rejected options and open questions; recent messages are limited to the latest 20 and 8,000 UTF-8 bytes.
- Retrieval is scoped, bounded (1–20 items, ≤16,000 response bytes), provenance-preserving and cannot override authoritative trip state.
- `agent/tests/evaluation/test_context_budget.py` now covers the 120-message compaction bound, the compaction threshold, stable-prefix byte equality, retrieval scope/limit/provenance/authoritative precedence, the measured byte/token counts and the LangSmith allowlist.

## Acceptance

Measured and asserted: token/byte counts, retained/compacted counts, stable-prefix byte equality and the redaction allowlist. Open (not claimed): live web→agent→workflow→provider trace inspection (no credentials), a live OTLP exporter connection (web emission is wired and unit-tested but no collector was run), and agent-side OTel span emission. Release-owner evidence review is still required.
