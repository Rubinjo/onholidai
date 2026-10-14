# Context and telemetry review

Status: harness exists; measurements and a live trace inspection are pending. No model or telemetry credentials were available for this implementation pass, and no values below are represented as measured.

## Synthetic measurement record

For each deterministic estimate/refinement run, record the corpus version and hash, seed, request count, UTF-8 context bytes, configured token budget, estimated input tokens, retained/retrieved item counts, compaction count, proposal/clarification/failure counts, and p50/p95 duration. Keep failed runs in the denominator. Compare an unchanged request with a changed trip version to confirm the stable system/tool prefix is byte-identical.

## Trace privacy review

Inspect one synthetic trace across web reservation, agent execution, workflow/provider boundary, and completion. Retain only the trace ID, component names, purpose, aggregate outcome, duration, and safe correlation fields. Confirm that prompts, responses, traveller facts, raw provider payloads, supplier amounts, and margin are absent at every hop. Do not attach production data or paste raw trace payloads into this file.

## Current implementation evidence

- Agent context starts with a fixed `STABLE_INSTRUCTIONS` prefix and a fixed allowlist of read-only tools.
- Context compaction keeps structured constraints, preferences, decisions, rejected options, and open questions; recent messages are limited to the latest 20 and 8,000 UTF-8 bytes.
- LangSmith receives an empty input object plus allowlisted purpose, outcome, duration, agent ID, and environment metadata.
- `agent/tests/evaluation/test_context_budget.py` covers the 120-message compaction bound. It was not run for this task.

## Acceptance

Pending: measured token counts and retrieval value, stable-prefix comparison, complete redacted trace inspection, and evidence review by the release owner.
