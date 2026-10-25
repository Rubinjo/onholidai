# Quickstart Validation Guide: AI Trip Planning Agent

This guide defines the runnable end-to-end evidence expected after implementation. It validates observable behavior against [the feature specification](./spec.md), [data model](./data-model.md), and [contracts](./contracts/README.md); it is not an implementation tutorial.

## Prerequisites

- Node.js 24 LTS and pnpm 12
- Python 3.13 and uv
- Docker Engine with Docker Compose v2
- Playwright browser dependencies
- Synthetic test credentials for Nebius, Google Maps Grounding Lite, Tavily, and travel-supply adapters, or deterministic local doubles
- No production customer, payment, provider, supplier-cost, or margin data

## Start the Local Stack

The web application requires independent `service_token_secret.txt` and `pricing_diagnostic_secret.txt` files in `infra/compose/secrets/`, alongside `web_auth_secret.txt`. Each contains at least 32 characters; use distinct values. The service key is shared with the agent transport; the pricing key stays in web/authorized diagnostic callers. Local non-container development uses synthetic defaults in `.env.example`. Production web startup requires explicit database/auth/service/diagnostic configuration. The booking worker uses a separate initializer: it requires explicit `DATABASE_URL` and `TEMPORAL_ADDRESS` in production, but no web auth or signing secrets. Keep its Compose secret mounts limited to `worker_db_password`. Build-only credentials in CI and Dockerfile are placeholders for shell compilation and are not installed as runtime environment values. The current schema is migrations 001–010; always apply the full ordered migration set through the controlled migration command.

Readiness is staged. After setup, install locked dependencies, start `--profile infrastructure` and run web/agent shell health checks with `pnpm dev`; no migration job, application container profile or booking worker is required. After foundation, run the `migrations` profile. The complete commands below require all story implementations through US4; `applications` runs containerized app services and `booking` runs the worker. Compose only resolves a `depends_on` target inside a profile that is enabled for that invocation, so every stage command names the profiles it needs — the migration job depends on `postgres`, so it enables `infrastructure` as well as `migrations`.

```bash
pnpm install --frozen-lockfile
uv sync --project agent --frozen
docker compose -f infra/compose/compose.yml --profile infrastructure up -d
docker compose -f infra/compose/compose.yml --profile infrastructure --profile migrations run --rm migrate
docker compose -f infra/compose/compose.yml --profile infrastructure --profile applications --profile booking up -d
```

Expected full-stack services: Next.js web/BFF, FastAPI agent, PostgreSQL 18 with PostGIS, Temporal development server and UI, TypeScript booking worker, and local observability collectors. Migration runs once through the controlled job before application/worker startup; do not rerun it concurrently with a separate local migration command. Redis is not required.

### Running on the host instead of containers

To run the applications on the host while PostgreSQL stays in Docker, start the infrastructure profile and apply migrations with the local migration runner:

```bash
docker compose -f infra/compose/compose.yml --profile infrastructure up -d postgres
pnpm --dir web db:migrate                 # uses MIGRATION_DATABASE_URL from .env
uv run --project agent uvicorn onholidai_agent.api.main:app --host 127.0.0.1 --port 8000
pnpm dev                                  # or: pnpm --dir web build && pnpm --dir web start
```

`docker compose ... --profile infrastructure up -d postgres` creates the least-privileged roles, the `onholidai` database and PostGIS from `infra/postgres/` on first start, using `infra/compose/secrets/*.txt`. Those secrets are git-ignored; recreate them from `.env` (see `.env.example`) if the compose command reports a missing secret file. `infra/postgres/init/10-create-local-databases.sh` must keep LF line endings — `.gitattributes` enforces that, because a CRLF shebang makes the container's init step fail silently and leaves no database to sign in against.

Run baseline checks in separate commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
uv run --project agent pytest
pnpm test:contracts
pnpm test:e2e
```

Use `pnpm format` to apply Black formatting to Python files and Prettier formatting to maintained TypeScript, JavaScript, CSS, JSON, YAML and Markdown files; `pnpm format:check` verifies both without rewriting files. Run `pnpm --dir web exec eslint . --fix` when imports need grouping, then run `pnpm format`.

Black is the only Python formatter; Ruff handles linting and Python import sorting. Prettier is the only JavaScript/TypeScript formatter; ESLint handles code quality, import grouping (Node built-ins, external packages, internal aliases, relative imports, then type-only imports), and separation after imports. Keep logically distinct top-level declarations separated by a blank line during review. Tailwind sorting uses the application's v4 stylesheet and recognizes `cn`, `clsx` and `cva`. Git attributes and EditorConfig keep text files LF-terminated with spaces for indentation.

The exclusions in the root `.prettierignore` preserve vendored public assets, tool-managed metadata, package-manager lock output, generated evaluation fixtures and generated JSON/OpenAPI schemas. Those artifacts retain their generator's deterministic formatting and drift checks; generated TypeScript is already formatted by its generator. Markdown wrapping preserves author-chosen line breaks. No commit hooks or format-on-save configuration is installed.

Each story runs its implemented suites and the applicable foundation/compatibility/accessibility checks; setup verifies shells/tooling only. Run the complete command matrix and all scenarios after US4. Do not waive failures in implemented behavior, or require a later story's UI/workflow to pass an earlier checkpoint. Corpus and participant protocols are defined in spec.md; record versions, seeds and denominators before implementation.

Cross-cutting acceptance also includes the privacy/compatibility, load, and browser suites. Run them only against isolated databases and synthetic deterministic fixtures:

```bash
pnpm --dir web test -- tests/integration/retention.test.ts tests/integration/migration-compatibility.test.ts
pnpm --dir web exec playwright test --config=playwright.performance.config.ts
pnpm --dir web exec playwright test -- tests/e2e/accessibility.spec.ts --grep @accessibility
uv run --project agent pytest agent/tests/contract/test_schema_compatibility.py agent/tests/evaluation/test_context_budget.py
```

The performance scenarios require `PERF_STORAGE_STATE`, `PERF_TRIP_ID`, and 20 synthetic authorized trips for booking (`PERF_AUTHORIZED_TRIP_IDS`, plus one `PERF_AUTHORIZATION_<trip-id>` per trip). The planning scenario launches asynchronous synthetic refinement requests without accepting proposals. Its one-minute at-rate sample is a smoke test; T110 release acceptance requires a full 60-minute soak and recorded capacity/resource metrics. Keep `PROVIDER_MODE=deterministic`.

## Scenario 1: Create an Initial Estimate

US1 runs without a booking worker. After provisioning secrets and applying the current ordered migrations, use infrastructure, migrations and applications profiles only. Agent receives the shared service secret and WEB_BASE_URL; the independent diagnostic key stays web-only. Keep browser origin equal to BETTER_AUTH_URL. For automated browser checks, provide US1_STORAGE_STATE for a synthetic account and optionally PLAYWRIGHT_BASE_URL (default http://localhost:3000). See [US1 evidence](./evidence/us1.md) for its recorded checks and open acceptance gates.

1. Open the trip setup using only the keyboard.
2. Confirm Amsterdam, Netherlands, Europe/Amsterdam as departure origin, with return to that origin; add Japan and South Korea through search, then Tokyo, Kyoto, and Seoul.
3. Add two availability windows and mark one preferred and one flexible.
4. Set duration to 12 minimum, 15 ideal, and 18 maximum days.
5. Add two adults and one child with age at trip start.
6. Set all five style preferences and enter constraints for no activities before 10:00, vegetarian food, and no more than three hotel changes.
7. Submit and observe agent progress, review the initial_estimate proposal, and explicitly accept it. Repeat with a competing version change and verify stale acceptance fails atomically.

Expected:

- Initial agent progress appears within 2 seconds and the estimate completes within the 30-second p95 budget under deterministic test conditions.
- The US1 estimate summary, accessible route preview and estimated total show the accepted version. The full three-pane workspace, conversation/history reload and cross-pane convergence are US2 checks in Scenario 2.
- Preferred and flexible dates remain distinguishable; any alternative date is proposed, not silently selected.
- Every price is labelled estimated and constraints are either reflected or visibly unresolved.
- Reloading restores the accepted authoritative estimate and its stored rationale; no proposal is applied merely by submitting research or reconnecting. Before flight search, missing/ambiguous origin requires confirmation and alternative airports remain reviewable.

## Scenario 2: Proposal, Acceptance, Conflict, and Undo

US2 adds migration 007 and the living-trip workspace. Apply the current ordered migrations with the controlled migration command before starting updated services. The agent keeps the Nebius Token Factory base URL from `.env.example`; set a real `NEBIUS_MODEL` and non-placeholder research credentials for live agent operation. Deterministic planning supply remains the default.

LangSmith settings are `LANGSMITH_TRACING=true`, `LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com`, a real `LANGSMITH_API_KEY`, `LANGSMITH_AGENT_ID=onholidai`, and `LANGSMITH_AGENT_ENVIRONMENT=local`. Compose forwards them to agent; local agent startup reads the root `.env`. Only allowlisted outcome metadata is exported. Graph state and raw prompts/responses are excluded before ingestion. LangSmith must have agent addressing enabled for the selected workspace.

For authenticated browser scenarios, provide `US1_STORAGE_STATE` and `US2_TRIP_ID` for a seeded Tokyo/Kyoto estimated draft whose date/duration limits allow two more nights. Run `pnpm --dir web test:e2e -- tests/e2e/refinement.spec.ts`. For database regressions, provide `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_MIGRATION_URL`, `TEST_DATABASE_APP_URL`, and `TEST_DATABASE_WORKER_URL`. See [US2 evidence](./evidence/us2.md) for automated results and open acceptance gates.

### Seeding the authenticated US2 fixture

There is no browser sign-up UI; accounts are created through the Better Auth API. Use the seeding helper instead of creating one by hand:

```bash
pnpm seed:us2-fixture
```

It creates or signs in the synthetic account `synthetic-us2@example.invalid`, writes a Playwright storage state, creates the Tokyo/Kyoto draft from the US1 setup inputs, runs one `initial_estimate` request, explicitly accepts the proposal, and prints the two variables the refinement suites need:

```bash
export US1_STORAGE_STATE=.playwright/us2-storage-state.json
export US2_TRIP_ID=<printed trip id>
pnpm --dir web test:e2e -- tests/e2e/refinement.spec.ts --project=chromium
```

Both refinement scenarios mutate the same trip, so `US2_TRIP_ID` must be re-seeded per run: the second scenario intends `Add two nights there` to be ambiguous, and a trip that already received those nights correctly answers with a feasibility question instead of a proposal. Run the scenarios one at a time rather than relying on the parallel default.

Measure the two-second convergence budget against a production build (`pnpm --dir web build && pnpm --dir web start`). Under `next dev` the compile/refresh latency can push staleness discovery past two seconds, which is a development-server artifact and not the measured result.

1. Ask: `Add two days in Kyoto and keep mornings free.`
2. Review the structured proposal and its schedule, route, accommodation, activity, and price impacts.
3. Before accepting, submit a direct trip edit from a second browser session.
4. Try to accept the now-stale proposal.
5. Generate a fresh proposal, accept it, then undo it.

Expected:

- The first request invokes only the allowlisted trip-domain tools in [agent-tools.schema.json](./contracts/agent-tools.schema.json), plus explicitly read-only research integrations.
- The editable summary, geographic/list itinerary, conversation and persistent total display the same version. Reload restores that snapshot plus the redacted conversation/history; this expectation starts at US2.
- No authoritative state changes before proposal acceptance.
- Acceptance with a stale `expectedVersion` returns a conflict and does not merge or partially apply operations.
- Fresh acceptance creates one immutable trip version and updates all panes within 2 seconds.
- Undo creates another version restoring the previous state; history remains inspectable.

## Scenario 3: Material Ambiguity and Context Retrieval

1. Create more than 100 synthetic conversation turns containing decisions and rejected options.
2. Ask: `Use the place we rejected earlier instead.`
3. Repeat with a uniquely identifiable rejected destination.

Expected:

- Compaction preserves `constraints`, `preferences`, `decisions`, `rejected_options`, and `open_questions`.
- Ambiguous reference produces one focused clarification rather than a state change.
- The unique reference causes bounded `retrieve_relevant_context` use and returns no more than 20 relevant items.
- Structured trip state takes precedence over contradictory historical text.
- Stable prompt/tool prefixes remain unchanged across otherwise equivalent turns.

## Scenario 4: Accessible Map and Three-Pane Workspace

1. At each story checkpoint, complete its available journey with keyboard and screen reader; after US4 complete setup, refinement, proposal review, undo, finalization and booking-summary navigation together.
2. Disable map loading and repeat destination selection and itinerary review.
3. Enable reduced motion and high zoom at desktop and mobile widths.

Expected:

- Every map action has a labelled list or form equivalent.
- Focus order follows trip summary, map equivalent, agent, and persistent price/booking regions logically.
- Agent progress and proposal arrival use non-disruptive live-region announcements.
- State, price freshness, warnings, and component outcomes do not rely on colour.
- Map failure preserves trip state and exposes retry plus non-map controls.
- No controls, labels, totals, or itinerary content overlap or become unreachable.

Run automated checks and retain manual keyboard/screen-reader evidence:

```bash
pnpm test:e2e -- --grep @accessibility
```

## Scenario 5: Pricing Disclosure Boundary

1. Load a synthetic trip with supplier amount, margin, taxes, fees, and final customer amount.
2. Inspect an authorized internal diagnostic projection.
3. Inspect all production customer pages, network responses, HTML, SSE events, client cache, logs, and traces.

Expected:

- Internal diagnostics show the calculation components only to an authorized role.
- Customer projections contain final total and required disclosures but no supplier amount or platform margin fields or values.
- Integer-minor-unit totals satisfy the invariant in [data-model.md](./data-model.md#money-and-pricing).
- Redacted telemetry contains correlation and outcome metadata but no sensitive traveller facts, raw prompts, supplier amounts, or margins.

## Scenario 6: Revalidation and Authorization Invalidation

### US3 planning gate (booking not required)

From a refined draft with sourced per-component service times and explicit destination timezones, select **Prepare detailed itinerary**, review the day plan and accept its proposal. Select **Review finalization**, resolve known conflicts through reviewed draft changes, acknowledge the current unverified conditions/exceptions, then explicitly finalize planning. Reload the saved result and use version history to undo back to a draft. Repeat with a known hard conflict and with map loading disabled; the blocking case must not advance the version or lifecycle. Booking remains disabled until US4.

Run `pnpm --dir web test -- tests/integration/finalization.test.ts` and `pnpm --dir web test:e2e -- --grep @us3`. Set `US3_TRIP_ID` to a fresh refined fixture and `US1_STORAGE_STATE` to its authenticated storage state. Broad synthetic supplier placeholder intervals may produce validly blocked schedules; a successful fixture must carry realistic accepted service times. See [US3 evidence](./evidence/us3.md) for corpus identity and outstanding manual/participant gates.

1. Finalize a synthetic trip and start booking revalidation.
2. Configure one provider double to change price and another to leave terms unchanged.
3. Accept changed terms and explicitly authorize the exact canonical summary.
4. Change a traveller, date, price, inventory item, or cancellation term before booking starts.
5. Attempt booking with the prior authorization.

Expected:

- Revalidation reports unchanged, changed, unavailable, or unknown per component.
- Authorization stores the canonical terms hash, current trip version, actor, and expiry.
- Every material change invalidates prior authorization.
- The booking request is rejected before any provider write and requires new revalidation and confirmation.
- A chat message such as `book it` never creates an authorization or starts a workflow.

## Scenario 7: Idempotent Partial Booking and Recovery

1. Authorize a trip with flight, accommodation, activity, and rail components.
2. Configure deterministic doubles so the flight confirms, accommodation times out after provider commit, activity definitively fails, and rail confirms.
3. Start booking, disconnect the browser, reconnect, and repeat the same booking request.
4. Resolve accommodation through provider-status reconciliation.

Expected:

- The API acknowledges workflow start within 500 ms and records the first component status within 5 seconds under local deterministic conditions.
- Repeated requests and Temporal replay reuse stable idempotency keys and create no duplicate provider actions.
- The accommodation is `unknown`, not failed, until status reconciliation confirms it.
- Flight confirmation advances the displayed trip version; rail still executes under the same immutable basis only after checking all intervening versions are status/evidence updates from this transaction with unchanged terms.
- Repeat with an external material edit before rail dispatch and with changed confirmed fare terms: pending writes stop and require fresh authorization; a material edit racing an in-flight/unknown write is rejected until reconciliation.
- Confirmed flight and rail remain confirmed; no automatic cancellation occurs.
- The failed activity and any uncertain component show explicit recovery actions.
- The final itinerary distinguishes confirmed, failed, and action-required components and retains provider evidence.

## Scenario 8: Component Rescheduling

1. Choose one confirmed rail component and request a new time conversationally.
2. Review the recommendation, then enter the separate rescheduling workflow.
3. Revalidate and authorize the exact new rail terms.
4. Complete rescheduling while observing unrelated components.

Expected:

- Conversation may recommend the change but cannot execute it.
- A fresh authorization is required for the new exact terms.
- The old and new provider references and outcomes are recorded.
- Unaffected flight, stay, and activity confirmations remain unchanged.

## Scenario 9: Contract and Failure Compatibility

Run contract and migration compatibility suites:

To intentionally refresh agent contracts after model changes, run `uv run --project agent python agent/scripts/export_contracts.py` followed by `pnpm --dir web agent:contracts`, review the source/promoted schemas and TypeScript/Zod diff, then run `pnpm test:contracts`. Normal validation uses check mode and does not rewrite reviewed artifacts.

```bash
pnpm test:contracts
pnpm --dir web db:migrate:test
uv run --project agent pytest tests/contract
```

Expected:

- Generated TypeScript types and Zod validators match the committed agent OpenAPI contract.
- Unknown event versions/types fail safely without applying state.
- Snapshot schema migrations preserve current and historical trip reads.
- Provider doubles cover changed terms, unavailable offers, timeout-after-commit, duplicate writes, contradictory callbacks, and partial failure.
- Error envelopes expose safe codes and correlation IDs, not raw provider or model payloads.
- Callback replay returns original durable receipts; conflicting fingerprints/cursor gaps do not commit, cross-run credentials are denied, result receipt follows its event receipt, and disconnect/process restart reloads stored outcomes or exposes interrupted failure without automatic trip application.

## Completion Evidence

Record test command results, policy/corpus versions and seeds, actual success/failure denominators, Playwright desktop/mobile screenshots, keyboard and screen-reader notes, representative trace IDs, Temporal workflow histories, and redacted booking outcomes. Apply spec.md's fixed 20-person usability protocol separately from deterministic evaluation; include failed cases and report simulated versus live performance distinctly. Acceptance requires passing behavior, contract, type, lint, migration, accessibility, and consequential-action safeguards; document any approved exception with owner and expiry.
