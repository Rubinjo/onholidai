# Release acceptance record

Status: not executed. This file records the release gates; it contains no test, browser, provider, or participant results.

| Gate | Status | Evidence |
|---|---|---|
| Quickstart commands and Scenarios 1–9 | Not run | Requires Node.js 24, pnpm 10, Docker Compose, PostgreSQL/PostGIS, Temporal, and synthetic credentials. |
| Lint, types, behavior, contracts, migrations, Temporal | Not run | Run the commands in `specs/001-ai-trip-agent/quickstart.md` in the equipped environment. |
| Desktop/mobile, Firefox ESR, keyboard and screen reader | Not run | See `evidence/accessibility.md`. |
| SC-001–SC-012 acceptance measurements | Not collected | Use fixed corpora and participant protocols from `spec.md`; report failure-inclusive denominators and separate synthetic/live results. |
| External provider capability and policy review | Open | Provider commercial access, cancellation/rescheduling availability, and jurisdiction-specific pricing/retention rules require owner confirmation. |

Release remains unaccepted until each applicable gate has an owner, recorded result, and reviewed evidence. Do not fill this table with inferred or simulated outcomes.
