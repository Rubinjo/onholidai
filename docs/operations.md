# Operations guide

## Services and startup order

Use Node.js 24, pnpm 10, Python 3.13/uv, and Docker Compose v2. Provision distinct 32-character secrets for the web auth, service token, and pricing diagnostics. Never share the pricing diagnostic key with the agent or browser. For local-only runs, `.env.example` contains synthetic defaults; production startup rejects synthetic auth and service secrets. Database-backed tests use isolated databases created from `TEST_DATABASE_ADMIN_URL`/`TEST_DATABASE_MIGRATION_URL`/`TEST_DATABASE_APP_URL`/`TEST_DATABASE_WORKER_URL` (provision the roles with `infra/postgres/test-roles.sql`); without them those suites skip. On Windows, set `PYTEST_DEBUG_TEMPROOT` to an apostrophe-free directory when the user profile path breaks pytest's default temp root.

Start `--profile infrastructure` for PostgreSQL 18/PostGIS, Temporal, and local observability. Apply schema migrations through the dedicated migration role using `--profile migrations`; migrations 001–010 are ordered and checksum-verified. Start `--profile applications` afterward. Start `--profile booking` only when the TypeScript Temporal worker is required. Do not run a second migration process concurrently.

## Provider capabilities

Deterministic doubles are the default. Live provider use requires separately provisioned credentials, commercial access, rate limits, and confirmation of the account's permitted operations. The project has adapters for Duffel flights, Booking.com Demand accommodation, GetYourGuide activities, and Trainline rail. Availability, status lookup, idempotent writes, cancellation, and rescheduling are capability-specific; consult `contracts/supply/README.md` and check the deployed adapter configuration before enabling an operation. An adapter declaration does not guarantee inventory or commercial access. Unknown outcomes stay `unknown` until reconciled; never retry an ambiguous provider write with a new key.

## Booking recovery

Check the booking's durable transaction and component status before taking action. For `unknown`, use the provider status query or authenticated callback reconciliation. Keep confirmed components and their provider references. A retry is permitted only after a definitive failure and fresh validation of the immutable authorization basis. Cancellation and rescheduling are separate provider actions requiring exact-term authorization. Do not infer authorization from chat or restart writes after a browser reconnect.

## Pricing policy

Customer projections use integer minor units and show the final customer amount, payable taxes/fees, estimate/live state, and freshness disclosures. Supplier amounts and platform margin are internal diagnostics, available only through the role-restricted web path. The pricing diagnostic secret is independent of service credentials. Jurisdiction-specific disclosure rules are not inferred by the application and must be supplied and approved by the business before live operation.

## Retention and deletion

Raw conversation messages expire 90 days after creation. History/context reads scrub expired message bodies in bounded batches, and expired messages are omitted from exports. Schedule `expireRawConversationMessages` daily using the web database role so inactive trips are cleaned even when their owners do not return. Trip, booking, authorization, and audit evidence enters a review after 24 calendar months without trip activity. This review does not itself delete records: immutable trip versions and transaction evidence remain preserved unless a configured business policy approves a precise deletion scope. No default deletion policy is provided.

An administrator may place or release a trip legal hold; each action is recorded in immutable audit evidence. Owners can request a scoped export; internal roles cannot request raw conversation export. Before authorizing deletion, confirm legal hold status and retain required transaction evidence. Record the configured policy ID and decision reason. Applicable privacy law, retention periods, and export requirements must be confirmed by the responsible legal/business owner.

## Health and evidence

`/api/health` and the agent `/health` endpoint check shell readiness. Database-dependent routes additionally require the schema migrations. Keep synthetic and live-provider acceptance reports separate. The release acceptance and cross-cutting evidence files list measurements that still require execution; do not treat local code review as provider, performance, or accessibility acceptance.
