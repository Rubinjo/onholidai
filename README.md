# OnHolid.ai

OnHolid.ai is a trip planning workspace with a Next.js web application, a FastAPI planning agent, PostgreSQL/PostGIS, and Temporal workflows. It stores versioned trip plans and treats estimates as proposals that require explicit acceptance. Provider booking actions require a separate review and authorization.

## Local development

Prerequisites and exact synthetic setup steps are in [the feature quickstart](specs/001-ai-trip-agent/quickstart.md). The supported local stack uses Node.js 24, pnpm 12, Python 3.13 with uv, and Docker Compose v2. Copy `.env.example` for host-run defaults, or provision distinct secrets under `infra/compose/secrets/` for Compose. Do not use production customer or payment data in development.

Start PostgreSQL/PostGIS and Temporal with the `infrastructure` profile, run the controlled migration job, then start the `applications` profile. Start the `booking` profile only when validating booking workflows. The current schema includes migrations 001–009; use the migration runner to apply them in order.

## Provider configuration and limits

Deterministic provider doubles are the default. Live mode requires credentials and provider access that are not included with this repository. The adapters are structured for Duffel flight, Booking.com Demand accommodation, GetYourGuide activity, and Trainline rail reads and transaction calls, but code presence does not establish commercial access, inventory availability, or supported cancellation and rescheduling in a market. Each operation must honor the declared adapter capability and surface unsupported actions.

Map/research credentials and agent-model credentials are configured separately. Missing or unavailable sources must remain visible as unverified; the application does not infer favorable terms. Read [the operations guide](docs/operations.md) for migrations, recovery, retention policy, and pricing controls.

## Production deployment

The hosted instance runs on a Leaseweb VPS with Caddy terminating TLS for `onholidai.nl`. Releases are built in GitHub Actions, published to GHCR by digest, and deployed with `infra/production/scripts/deploy-vps.sh`; host preparation, required secrets, backups, and rollback are documented in [the production runbook](infra/production/README.md).

## Guest planning

On `/trips/new`, the information icons beside route ordering and travel styles explain how each choice guides AI recommendations. Hover over an icon or focus it with the keyboard to read its tooltip; Escape dismisses it. **My order** preserves your stop sequence, while **Let AI arrange** lets AI compare route orders, travel time and available pricing for your review, without guaranteeing savings. Each availability window has a **Delete** button; removing a window adjusts the trip duration to fit the remaining dates.

Guest setup, private planning, free registration and selected-trip linking are implemented. See the [guest quickstart](specs/002-platform-guest-planning/quickstart.md) and [handoff](specs/002-platform-guest-planning/evidence/implementation-status.md). Story tests are unrun, scenario coverage is partial, and manual/participant gates remain open. Schema migrations extend through 012; deploy compatible web/booking workers together.

## Website branding

The shared home link uses `web/public/logo/main_logo.svg` in the homepage header and footer, trip setup, and authentication pages. Both SVG assets use a sage accent (`#78a98f`) to distinguish the landscape and sun from the light page background. Root layout metadata applies `web/public/logo/main_icon.svg` to browser tabs on every route, with a transparent 32px PNG fallback and a white-backed 180px Apple touch icon for home-screen bookmarks. When replacing the icon artwork, regenerate `web/public/logo/favicon-32.png` and `web/public/logo/apple-touch-icon.png` from the SVG, preserving its aspect ratio and the Apple icon's padding. Use transparent padding when fitting the non-square SVG into the square favicon; an opaque fill creates an uneven white edge.

## Validation

Run the workspace commands from the quickstart after the stack is available. Release evidence and gates are tracked in `specs/001-ai-trip-agent/evidence/acceptance.md`.
