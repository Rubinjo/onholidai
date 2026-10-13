# Agent contract implementation evidence

Date: 2026-10-12. Scope: T030, T031 and convergence task T121. Status: implemented; remaining web quality gates are unverified.

## Behavior

Pydantic owns bounded request/context, result, event, problem, clarification, callback receipt and read/proposal/retrieval tool models. Unknown versions/fields/tools fail closed. Constraints include 12,000 Unicode characters per run message, 20 recent messages, 1–32 proposal operations, 70% compaction, 1–20 retrieval items, 500-character query/reason bounds, 32 entity IDs and depth/UTF-8 byte budgets. Proposed results bind request/base version/purpose; receipt result kinds match statuses and active run leases are checked. Initial estimates cannot complete as unreviewable answers. Omitted first-run summaries resolve to empty lists at the reserved version.

Draft targets reject transaction/protected state. Nested internal pricing fields are rejected, including spelling/casing variants. Already committed booking status may appear in authoritative read context, but cannot become a draft transaction command. Event variants flatten inherited fields into closed schemas. Problems use bounded machine codes and safe fields; request validation alone does not prove actual producer redaction.

`agent/scripts/export_contracts.py` writes identical source/promoted OpenAPI and tool schemas. Deterministic JSON is used in `.yaml` artifacts, valid under YAML 1.2. Callback request/receipt schemas in the web API reference these definitions. `web/scripts/generate-agent-contracts.ts` emits TypeScript and Zod, preserves default/union/closed-object semantics and cross-field rules, and fails on unsupported schema or conditional keywords. JSON budget guards run before recursive Zod validation. Schema composition checks handle recursive JSON definitions without infinite traversal.

The root package declares the same pinned Zod as web for validators under contracts/. The locked workspace installation and production web build have now executed successfully. Docker container builds remain unverified.

## Executed checks

- `agent/.venv/Scripts/python.exe -m pytest agent/tests -q`: **35 passed**. The tests include all **36** shared cases in `contracts/agent-api/validation-cases.json`, first-run defaults, historical summary provenance, Unicode boundaries, protected-key spelling variants, status/lease consistency and an actual export CLI drift failure in an isolated temporary directory.
- `agent/.venv/Scripts/python.exe -m ruff check agent`: passed.
- Python exporter generation and `--check`: passed against all four committed agent schema files.
- The available JavaScript runtime stripped TypeScript and ran the actual generator; generation and check mode passed for `generated.ts` and `generated.zod.ts`.
- JavaScript semantic checks passed for matching/conflicting request and base versions, result/status pairs, required scopes, protected targets/values, Unicode boundaries, sensitive key variants, initial-estimate result state and unsupported conditional schemas. A 10,000-level JSON object was safely rejected by the early depth guard. These checks do **not** execute Zod's structural parser.
- Generated TypeScript/Zod syntax stripping passed. This is not a TypeScript type check.

## Remaining gates and boundaries

Follow-up (2026-10-12): a Node 24.21.0 runtime was found through Python tooling and pnpm 10.18.3 installed the frozen workspace. Web lint/typecheck, generated-Zod parity, Swagger/reference/promotion validation, generation/drift, non-database Vitest and a production Next.js build now pass. PostgreSQL, Docker, Temporal and authenticated browser/manual gates remain pending. See evidence/us1.md for exact results and limitations.

Models and schemas alone are not the persistence boundary. T032/T036/T038/T122 now implement scoped durable callbacks, cursor continuity, lease handling, trusted pricing and explicit acceptance; T033–T035/T123 implement the read-only estimate graph. T046/T136 remain uncompleted acceptance gates. No live-provider, participant or manual screen-reader evidence is claimed; T116–T119 retain their deferred database validation status.
