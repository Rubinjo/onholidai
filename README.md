# OnHolid.ai

OnHolid.ai is a trip planning workspace with a Next.js web application, a FastAPI planning agent, PostgreSQL/PostGIS, and Temporal workflows. It stores versioned trip plans and treats estimates as proposals that require explicit acceptance. Provider booking actions require a separate review and authorization.

## Local development

Prerequisites and exact synthetic setup steps are in [the feature quickstart](specs/001-ai-trip-agent/quickstart.md). The supported local stack uses Node.js 24, pnpm 12, Python 3.13 with uv, and Docker Compose v2. Copy `.env.example` for host-run defaults, or provision distinct secrets under `infra/compose/secrets/` for Compose. Do not use production customer or payment data in development.

Start PostgreSQL/PostGIS and Temporal with the `infrastructure` profile, run the controlled migration job, then start the `applications` profile. Start the `booking` profile only when validating booking workflows. The current schema includes migrations 001–009; use the migration runner to apply them in order.

## Provider configuration and limits

Deterministic provider doubles are the default. Live mode requires credentials and provider access that are not included with this repository. The adapters are structured for Duffel flight, Booking.com Demand accommodation, GetYourGuide activity, and Trainline rail reads and transaction calls, but code presence does not establish commercial access, inventory availability, or supported cancellation and rescheduling in a market. Each operation must honor the declared adapter capability and surface unsupported actions.

Map/research credentials and agent-model credentials are configured separately. Missing or unavailable sources must remain visible as unverified; the application does not infer favorable terms. Read [the operations guide](docs/operations.md) for migrations, recovery, retention policy, and pricing controls.

## Validation

Run the workspace commands from the quickstart after the stack is available. Release evidence and gates are tracked in `specs/001-ai-trip-agent/evidence/acceptance.md`.
