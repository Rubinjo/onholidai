# US1 implementation evidence

Date: 2026-10-12. Status: implementation in progress; the US1 checkpoint is incomplete.

## Implemented slice

T023–T028, T037 and T120 add availability normalization without preference mutation, party/preference/constraint/origin/destination values, injected bounded place lookup, integer-money/customer-safe projections, normalized read-only planning offers, atomic version-one creation, owned current/historical reads, bounded agent views, common proposal models/storage and restricted pricing diagnostics. Existing aggregate schemas and the sole trip commit transaction are reused.

Creation carries an actor-scoped idempotency receipt, immutable version, redacted outbox event and audit in one transaction. Concurrent exact retries return the original version-one response. Unknown or inconsistent snapshots, protected draft operations and changed replay fingerprints are rejected. Recorded proposals must match a reserved run's user/trip/request/purpose/base version and active lease; recording cannot change trip state. Pricing diagnostics require both a separate signing secret and an allowed database-held role, and retain ownership checks.

Migration 004 introduces reserved-run and common-proposal storage. It does not establish operational run dispatch, event/result receipt callbacks, lease sweeps or proposal acceptance; those remain later tasks. The planning facade exposes search only, limits provider results and enforces an eight-second deadline even if an injected adapter ignores abort. Missing eligibility/occupancy/accessibility stays unverified and expired offers stay expired. Concrete live provider adapters are still pending.

## Executed checks

- `agent/.venv/Scripts/python.exe -m pytest agent/tests -q`: 17 passed, including new web-audience read/proposal grants and rejection of pricing access on agent-audience tokens. This does not execute the new web tests.
- `agent/.venv/Scripts/python.exe -m ruff check agent`: passed.
- `git diff --check`: passed at the implementation review.
- PowerShell JSON parsing: `contracts/supply/offers-v1.schema.json` and `contracts/events/trip-events-v1.schema.json` parsed successfully.
- PowerShell comparison: source/promoted web OpenAPI remains identical after the required agent-reference rewrite.

## Written but unexecuted coverage

`web/tests/unit/planning-values.test.ts`, `supply-read.test.ts`, `api.test.ts`, `web/tests/contract/estimate-api.test.ts` and `web/tests/integration/trip-planning.test.ts` cover aggregate initialization, invalid inputs, ambiguous places, money invariants, pricing projection, source failure/deadlines, browser/scoped-service authorization, separate diagnostic signing, safe errors, concurrent creation/replay, rollback, ownership, role checks and proposal identity. The PostgreSQL suite is included in the foundation CI gate; the historical upgrade expectation includes migration 004.

Node.js and pnpm are unavailable on PATH, `web/node_modules` is absent, and Docker is unavailable. Web lint/type/build, Vitest, generated-contract drift, PostgreSQL and browser suites were not executed. No runtime acceptance or coverage threshold is claimed. When tooling is available, run locked installs, `pnpm lint`, `pnpm typecheck`, `pnpm --dir web build`, `pnpm --dir web exec vitest run tests/unit tests/contract`, `pnpm --dir web test:foundation` with the four isolated database URLs, and `pnpm test:contracts`.

## Remaining acceptance evidence

No estimate flow, explicit priced proposal acceptance, setup/review UI, browser accessibility journey, frozen-corpus evaluation, latency measurement or fixed-cohort usability study is complete. No participant or screen-reader evidence was generated. The synthetic place catalogue is explicitly labelled; live place lookup returns unavailable until its adapter exists. Provider commercial access and live inventory are unverified. T116–T119 also retain their previously deferred web/database validation gates.

Compose web startup now needs independent `service_token_secret.txt` and `pricing_diagnostic_secret.txt` alongside `web_auth_secret.txt`, each at least 32 characters. Production requires explicit database/auth/service/diagnostic settings. CI/Docker build-only placeholders are not runtime secrets. The pricing secret must never be passed to the agent.
