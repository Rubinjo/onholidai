# Quickstart Validation Guide: AI Trip Planning Agent

This guide defines the runnable end-to-end evidence expected after implementation. It validates observable behavior against [the feature specification](./spec.md), [data model](./data-model.md), and [contracts](./contracts/README.md); it is not an implementation tutorial.

## Prerequisites

- Node.js 24 LTS and pnpm 10
- Python 3.13 and uv
- Docker Engine with Docker Compose v2
- Playwright browser dependencies
- Synthetic test credentials for Nebius, Google Maps Grounding Lite, Tavily, and travel-supply adapters, or deterministic local doubles
- No production customer, payment, provider, supplier-cost, or margin data

## Start the Local Stack

Readiness is staged. After setup, install locked dependencies, start `--profile infrastructure` and run web/agent shell health checks with `pnpm dev`; no migration job, application container profile or booking worker is required. After foundation, run the `migrations` profile. The complete commands below require all story implementations through US4; `applications` runs containerized app services and `booking` runs the worker.

```bash
pnpm install --frozen-lockfile
uv sync --project agent --frozen
docker compose -f infra/compose/compose.yml --profile infrastructure up -d
docker compose -f infra/compose/compose.yml --profile migrations run --rm migrate
docker compose -f infra/compose/compose.yml --profile infrastructure --profile applications --profile booking up -d
```

Expected full-stack services: Next.js web/BFF, FastAPI agent, PostgreSQL 18 with PostGIS, Temporal development server and UI, TypeScript booking worker, and local observability collectors. Migration runs once through the controlled job before application/worker startup; do not rerun it concurrently with a separate local migration command. Redis is not required.

Run baseline checks in separate commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
uv run --project agent pytest
pnpm test:contracts
pnpm test:e2e
```

Each story runs its implemented suites and the applicable foundation/compatibility/accessibility checks; setup verifies shells/tooling only. Run the complete command matrix and all scenarios after US4. Do not waive failures in implemented behavior, or require a later story's UI/workflow to pass an earlier checkpoint. Corpus and participant protocols are defined in spec.md; record versions, seeds and denominators before implementation.

## Scenario 1: Create an Initial Estimate

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
