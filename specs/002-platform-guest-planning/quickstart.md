# Quickstart Validation: Platform UX, Guest Planning & Account Creation

## Phase 9 redesigned journey

See [Phase 9 evidence](evidence/phase9.md) for current results and incomplete gates.
Start signed out: choose a country on the globe, replace it with cities, search with
Enter or the icon, reorder manually or select Let AI arrange, and verify reset retains
the mode. AI's proposed route accounts for outbound and return geography across all
confirmed departure alternatives when their coordinates are available; otherwise it
preserves the supplied order. Add multiple confirmed departure alternatives for the same party. Select
non-contiguous calendar ranges, adjust the three duration handles and 1–10 preferences,
then submit directly to the three-pane workspace. No intermediate estimate page or
Sheet should appear. Accept/reject proposals only in chat; history/undo stay on the left.
To research a new order/origin recommendation after an edit, use Research route options.

Verify the shared globe editor in the middle pane and collapsed details on the left.
Clean fields follow accepted changes; concurrent unsaved fields remain tied to their
original version until explicit reload/review. Check unavailable map/geometry and
transport labels without inferring verified routes. Guest notice must disappear when
authenticated. Finish a supported itinerary, explicitly link it through free sign-up,
sign out and sign in again: linking must not create booking consent or provider writes.

The standalone `pnpm --dir web booking:worker` now registers Node hooks and composes its
own application. Configure `DATABASE_URL` with the worker role and the reviewed Temporal
address/namespace/task queue. Local actual-entry startup is tested; do not infer a
deployed rollout or enable live transactions without the separate release evidence.

For production-mode browser verification, use HTTPS so every engine receives the
unchanged Secure/__Host- planning cookie. A local-only fixture can set
`BETTER_AUTH_URL=https://localhost:3443`, serve the production app on port 3000 and run
`node scripts/local-https-proxy.mjs` from the repository root with `LOCAL_TLS_CERT` and
`LOCAL_TLS_KEY` pointing to a freshly generated temporary certificate/key. Use
`PLAYWRIGHT_BASE_URL=https://localhost:3443`; opt into that self-signed test certificate
only with `PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true`. Do not install the test key/certificate
in the repository, change production cookie flags, or use certificate bypass for live
services. Default browser runs still validate certificates.

Guest setup, planning, linking, registration and marketing are implemented and verified against a local stack (Node.js 24, pnpm 12, Docker with PostgreSQL/PostGIS and Temporal, and the deterministic agent). See [implementation status](evidence/implementation-status.md), [spec](spec.md), [data model](data-model.md) and [contracts](contracts/README.md) for the executed commands, results and remaining gaps.

Deploy web and booking worker from the same reviewed revision after fresh/upgrade checks for migrations 011/012. No deployment/migration was run here. Guest defaults are two active runs, ten new runs/session-hour and twenty sessions/network-hour. GUEST_TRUST_PROXY_IP defaults false (shared conservative bucket); enable only behind an edge that overwrites x-real-ip. GUEST_NETWORK_SECRET optionally separates the digest key. Keep cookie/Origin/ownership/account-booking protections active.

## Prerequisites and stack

Node 24/pnpm 12, Python 3.13/uv, Docker Compose v2, and Playwright browsers. Use existing synthetic environment/secrets from [original quickstart](../001-ai-trip-agent/quickstart.md) and .env.example. Keep auth/service/diagnostic secrets distinct and customer/production data absent. No Redis, additional map key, or new auth provider.

After implementation and reviewed lockfile, build application/migration images from the reviewed revision before running migrations:

```powershell
pnpm install --frozen-lockfile
uv sync --project agent --frozen
docker compose -f infra/compose/compose.yml --profile infrastructure up -d
docker compose -f infra/compose/compose.yml --profile infrastructure --profile migrations build migrate
docker compose -f infra/compose/compose.yml --profile infrastructure --profile migrations run --rm migrate
docker compose -f infra/compose/compose.yml --profile infrastructure --profile applications up -d --build
```

Use one migration runner, not parallel host/container jobs. For host apps follow the original quickstart, with separate pnpm dev/pnpm dev:agent terminals instead of duplicate container apps. Keep PROVIDER_MODE=deterministic, browser Origin=BETTER_AUTH_URL, and existing shared service-secret configuration. Booking worker is unnecessary for setup/refinement/linking-only checks; start it for transaction regression:

```powershell
docker compose -f infra/compose/compose.yml --profile infrastructure --profile booking up -d --build booking-worker
```

Integration tests need TEST_DATABASE_ADMIN_URL, TEST_DATABASE_MIGRATION_URL, TEST_DATABASE_APP_URL and TEST_DATABASE_WORKER_URL as existing isolated helpers require. Missing configuration or skipped suites are not acceptance. Guest browser tests explicitly use new empty contexts and no inherited US1_STORAGE_STATE; existing account tests retain their fixtures. Do not print secrets.

### Browser-run prerequisites

Observed while running the suites; each is an environment property, not a product setting.

- The isolated test database and the running app compete for PostgreSQL connections. Stop the
  dev/production server before `pnpm --dir web test`, or expect connection timeouts.
- Guest journeys share one per-network bootstrap allowance. `GUEST_MAX_SESSIONS_PER_HOUR` is
  capped at 200 by the config schema, so repeated browser runs inside one hour exhaust it and
  every bootstrap returns 429. Clear the ephemeral rows (or wait an hour) before re-running:
  `DELETE FROM app.guest_bootstrap_buckets;` — they already expire after one hour by design.
- `pnpm --dir web build` must run with `NODE_ENV=production`; a `development` override makes
  prerendering the global error page fail. After a production build, delete `web/.next`
  before starting `pnpm dev` again, otherwise the dev client can serve stale chunks and never
  hydrate the draft.
- A production build served over plain HTTP cannot hold its `Secure` `__Host-` guest cookie in
  Safari/WebKit. Run the cross-browser matrix against the configured dev server, and verify the
  production build separately.
- The two refinement journeys commit and undo changes on their seeded trip, so seed one trip per
  journey and run them on one project:

  ```powershell
  node scripts/seed-us2-fixture.mjs            # prints US2_TRIP_ID
  node scripts/seed-us2-fixture.mjs            # prints the second trip for US2_REFINEMENT_TRIP_ID
  $env:US1_STORAGE_STATE = ".playwright/us2-storage-state.json"
  $env:US2_TRIP_ID = "<first>"
  $env:US2_REFINEMENT_TRIP_ID = "<second>"
  pnpm --dir web test:e2e
  ```

- The compose `booking-worker` cannot start yet: `web/server/workflows/alias-loader.mjs`
  exports the hook but never calls `module.register`, so `@/*` specifiers reach Node as bare
  package names. Planning-only verification does not need it.

## Check commands

Run relevant changed-behavior gates per increment, then full release checks using existing scripts:

```powershell
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web test
pnpm test:contracts
pnpm test:migrations
pnpm test:temporal
pnpm test:e2e
pnpm --dir web build
```

During implementation add behavioral suites web/tests/integration/guest-planning.test.ts, setup-drafts.test.ts, account-linking.test.ts and booking-planning-identity.test.ts, plus unit/contract cases and web/tests/e2e/guest-planning.spec.ts, booking-auth.spec.ts, platform-ux.spec.ts. Once present, run:

```powershell
pnpm --dir web test -- tests/integration/guest-planning.test.ts tests/integration/setup-drafts.test.ts tests/integration/account-linking.test.ts tests/integration/booking-planning-identity.test.ts
pnpm --dir web exec playwright test tests/e2e/guest-planning.spec.ts tests/e2e/booking-auth.spec.ts tests/e2e/platform-ux.spec.ts
```

Keep existing estimate/refinement/finalization, receipt, privacy/pricing, migration and booking authorization/workflow tests. Run agent tests/type/lint if agent/transport/context semantics change; contract checks remain required for stable principal wire compatibility. Never count missing tests or environment skips as a pass.

## US1: Guest globe setup and acceptance

Fresh signed-out browser: open /trips/new, choose a country/two cities, reorder/replace/remove through globe and search/list. Confirm origin; preferred/flexible windows and valid duration; adult/child ages, five preferences and required free-text constraint. Backtrack/refresh each step. Submit, observe research/clarification, review and explicitly accept, then reload.

Expected: no account gate; default prominent globe, identical route order, recovery of saved entries/step, origin required, no automatic proposal application, original trip after retry and accepted version restored. Invalid submission creates no partial valid trip. Disable globe/worker and complete through keyboard/search/list. Lose the initial reservation response and prove same-request replay; simulate terminal research failure or linking revocation and prove explicit retry reserves a fresh request/run on the same trip while preserving original receipts.

## US2: Private guest refinement and recovery

Accept change, review impacts, inspect history, undo and finalize where supported. Interrupt/reconnect run/event delivery. Another guest/account attempts exact draft/trip/run/proposal IDs/history/streams. Expire/clear cookie; exercise quota with injected time and duplicate research replay. Two tabs conflict on one draft.

Expected: consistent accepted version in panes; unrelated/expired access denied; identifiers cannot recover ownership; durable evidence survives delivery; expiry does not delete history; 429 retry guidance without account gate; stale saves commit nothing and local edits survive. Initial trip submission replay and research retry cannot create duplicates.

## US3: Free authentication, linking and booking

Use two guest trips in same session and existing account with unrelated trip. Choose booking for one eligible trip; verify why account is required, free registration/no subscription/payment requirement, sign-in/sign-up/cancel/back/errors. Complete continuation. Repeat with lost responses, same-account replay, competing account/tab claims, save/link race and active research.

Expected: only selected principal links; same trip/version/history/request IDs; others remain separate. Guest streams/old service grants stop, active research visibly retryable, completed results still readable, consumed link receipt recovers after cookie expiry. Wrong proof/unsafe return/expired unused intent/another account fails without disclosure. Linking alone creates zero booking authorizations/transactions/provider writes.

Use principal ID different from account ID to test all booking revalidation/authorization/start/status/recovery/cancellation/rescheduling entry points and worker outcomes. Trip operations use principal, booking evidence uses account. Verify live revalidation, separate current exact-term confirmation, material-change invalidation, duplicate prevention, partial/unknown-outcome recovery and immutable execution basis. Existing authorized transactions retain policy; logout does not itself authorize or cancel anything.

## US4: Marketing

Anonymous homepage exposes value, process, CTA, account-free planning, clearly illustrative travel examples/alt text and evidence-based trust statements. Follow planning/auth links; no embedded builder/session bootstrap. Claims reflect enabled booking and do not promise guaranteed savings/inventory/endorsements. Record usage rights/attribution if adding imagery.

## US5: Responsive/accessibility/motion

Exercise every core route at 320/390/768/1440 widths and 200% zoom, keyboard, screen reader, forced colors and reduced motion. Check heading/error/dialog-close/removal focus, labelled route actions/preference ranges, status announcements and unobstructed summaries/totals. Include loading/empty/conflict/map failure/research failure/expiry/accept/link success and failure. Deterministic actions acknowledge within one second and never await decoration.

## Migration and release evidence

Fresh database and legacy 001–010 upgrade fixtures prove same historic IDs/snapshots/fingerprints/terms hashes/execution JSON, old account access, new guest FKs and least-privilege grants. Principal/account joins must cover domain and worker paths. Feature-disable rollback retains guest records; no destructive down migration.

Before implementation freeze >=20 participant task briefs, including >=5 keyboard/screen-reader users, >=5 family and >=5 multi-destination planners. Record spec timing/rating/count denominators and failures; developer judgement cannot substitute SC-001/002/003/007/010 evidence. Report deterministic/live-provider timing separately. Store evidence under specs/002-platform-guest-planning/evidence/: commands, skips/reasons, fixtures, races/replay, screenshots, manual accessibility notes and anonymized scores. Required code/type/lint/contract/migration/accessibility/transaction gates remain mandatory.
