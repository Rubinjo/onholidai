<p align="center">
  <img src="../web/public/logo/main_logo.svg" alt="OnHolidai" width="320" />
</p>

# Operations

Keep the travel-planning experience reliable, connect live research sources, and understand what an offer or booking status actually means.

Start with the [local quickstart](../README.md#run-it-locally) for setup. This guide covers day-to-day operation and troubleshooting, not host provisioning.

[Project overview](../README.md) | [Development and testing](development.md) | [Shared contracts](../contracts/README.md) | [Production deployment](../infra/production/README.md)

## Start and inspect the local stack

Run commands from the repository root with your configured `.env` and Docker secrets in place.

```bash
docker compose --env-file .env -f infra/compose/compose.yml --profile infrastructure up -d
docker compose --env-file .env -f infra/compose/compose.yml --profile infrastructure --profile migrations run --rm migrate
docker compose --env-file .env -f infra/compose/compose.yml --profile infrastructure --profile applications up -d
```

Run one migration job at a time. The migration runner applies the full ordered set in [the migrations directory](../web/server/db/migrations/). An existing database volume keeps its initialized roles and passwords. Changing a secret file does not rotate a database password automatically.

```bash
docker compose --env-file .env -f infra/compose/compose.yml --profile infrastructure --profile applications ps
docker compose --env-file .env -f infra/compose/compose.yml logs --tail 100 web agent
curl --fail http://localhost:3000/api/health
```

A healthy process does not prove that a provider key, database role, or browser session works. Check the user journey relevant to your change as well as container health.

For host-run services and isolated test databases, use [Development and testing](development.md). Container service names such as `postgres`, `agent`, and `temporal` are not host addresses.

## Choose deterministic or live mode

| Mode            | What to expect                                                           | Credentials                                                                       |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `deterministic` | Synthetic model responses and supplier offers for repeatable development | No paid provider keys required                                                    |
| `live`          | Real model calls and verified research operations                        | Provider-specific credentials, supported operations, and recorded access evidence |

Set `PROVIDER_MODE` consistently across the web application, agent, and any worker. Deterministic results are examples, not current prices, inventory, reservations, or proof of commercial access.

### Connect live planning and destination research

The live agent needs non-synthetic values for `NEBIUS_API_KEY`, `NEBIUS_MODEL`, `MAPS_GROUNDING_API_KEY`, and `TAVILY_API_KEY`.

| Connection                       | Configuration                                                | Contribution                                                                                  |
| -------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Nebius Token Factory             | `NEBIUS_API_KEY`, `NEBIUS_MODEL`, optional `NEBIUS_BASE_URL` | Model inference through the OpenAI-compatible API, including available NVIDIA Nemotron models |
| Google Maps                      | `MAPS_GROUNDING_API_KEY`                                     | Grounding Lite MCP place research in the agent                                                |
| Google Places and Time Zone APIs | The same Maps key in the web process                         | Destination matching and timezone resolution for the planning form                            |
| Tavily                           | `TAVILY_API_KEY`                                             | Web research through `/search`                                                                |

Choose a model identifier available to your Nebius account. NVIDIA model availability does not mean every deployment uses one automatically.

Enable the Google APIs needed by both processes and check key restrictions against their intended use. Place matching and timezone lookup must both succeed before a resolved destination becomes trusted trip data.

## Connect live travel sources

Supplier search goes through the web-owned gateway. The agent receives constrained tools and public offer data, not supplier credentials.

| Connection | Active product | Search prerequisites                                                                              |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------- |
| Duffel     | Flights        | Confirmed departure and arrival places, supported dates, and traveller context                    |
| Nuitee     | Accommodation  | Confirmed destination, dates, occupancy, child ages where relevant, and departure-country context |
| Viator     | Activities     | A trusted numeric destination mapping and supported dates                                         |

Duffel can resolve airport suggestions when a saved IATA mapping is absent. Nuitee resolves destinations through LiteAPI before searching stays. Do not replace missing prerequisites with guessed coordinates, airport codes, citizenship, or provider destination IDs.

Duffel Stays is not an active accommodation source. Previously saved evidence may remain visible, but new stay research uses Nuitee. Rail is not an active supplier integration.

### Give each process only the credentials it needs

| Process          | Allowed credential purpose                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Agent            | Model and research credentials, plus the scoped service-token secret                           |
| Web              | Supplier discovery credentials, application database role, auth and diagnostic signing secrets |
| Booking worker   | Separately approved transaction credentials and the worker database role                       |
| Migration runner | Migration database role only                                                                   |

The local Compose configuration forwards discovery credentials under `DUFFEL_READ_SECRET`, `NUITEE_SECRET`, and `VIATOR_SECRET`. Match `readSecretRef` to these exact variable names rather than embedding a key in `SUPPLIER_PROVIDERS`.

Keep Duffel discovery and booking credentials separate. Flight discovery creates offer requests with a POST. A dedicated discovery credential does not guarantee upstream read-only permissions, so scope and protect it accordingly.

Keep `PRICING_DIAGNOSTIC_SECRET` web-only. Never put supplier secrets, payment tokens, internal cost data, or diagnostic signatures into model prompts, public snapshots, screenshots, or shared logs.

### Declare capability without claiming verified access

`SUPPLIER_PROVIDERS` is a JSON configuration value. This discovery-only example has no transaction credential references and deliberately leaves access unverified:

```json
{
  "duffel": {
    "readSecretRef": "DUFFEL_READ_SECRET",
    "operations": {
      "search": {
        "support": "supported",
        "access": "configured_unverified"
      },
      "detail": {
        "support": "supported",
        "access": "configured_unverified"
      }
    }
  },
  "nuitee": {
    "readSecretRef": "NUITEE_SECRET",
    "operations": {
      "search": {
        "support": "supported",
        "access": "configured_unverified"
      },
      "detail": {
        "support": "supported",
        "access": "configured_unverified"
      }
    }
  },
  "viator": {
    "readSecretRef": "VIATOR_SECRET",
    "accessTier": "unknown",
    "operations": {
      "search": {
        "support": "supported",
        "access": "configured_unverified"
      },
      "detail": {
        "support": "supported",
        "access": "configured_unverified"
      }
    }
  }
}
```

In `.env`, store this as one compact, single-quoted JSON value. A supported declaration describes the implementation, not permission to call a supplier.

For a live operation to become verified, it must have all of the following:

- Implemented support for that product and operation
- A real credential available in the correct process
- `access: "verified"` with a nonempty `evidenceRef` and valid `verifiedAt`
- Verification for the selected environment wherever the provider requires it
- The commercial access tier required for that operation

Record evidence from an authorized, bounded verification exercise. Do not copy example evidence or mark access verified because a key exists.

Nuitee uses `NUITEE_ENVIRONMENT` and Viator uses `VIATOR_ENVIRONMENT` to distinguish sandbox from production. Changing environments requires matching verification, not just changing the URL or enum.

Nuitee final revalidation and transaction operations remain blocked until a safe exact-terms path exists. Viator booking, cancellation, and rescheduling require merchant access. Full Access + Booking affiliate access can support approved status reads, not merchant writes.

The [configuration implementation](../web/server/config.ts) defines the accepted fields and readiness rules. The [supplier-tool schema](../contracts/supply/supplier-tools-v1.schema.json) defines the constrained MCP interface.

## Diagnose the journey, not just the container

| Symptom                                     | Check                                                                     | Next step                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Web or agent is unavailable                 | Container state, health, startup logs, configured base URLs               | Resolve the failed dependency before retrying the journey                                                  |
| Database permission or authentication error | Role-specific URL, initialized volume, matching password                  | Repair or deliberately rotate the correct role, not the application's privileges                           |
| Destination lookup fails                    | Google API enablement, restrictions, and place/timezone responses         | Fix lookup configuration and resolve the destination again                                                 |
| `429` during guest planning                 | Guest session and network quotas                                          | Respect the retry interval and configured limits                                                           |
| `503` during planning                       | Agent health, service-token agreement, live-provider configuration        | Restore the dependency before submitting another request                                                   |
| `202` after starting a run                  | The returned run identifier and status stream                             | Follow that run instead of creating duplicate requests                                                     |
| Supplier is unconfigured or unverified      | Process credential, operation support, evidence, environment, access tier | Complete authorized verification or keep the source unavailable                                            |
| No supplier results                         | Dates, party details, destination mapping, source status                  | Distinguish no inventory from a timeout, missing prerequisite, or denied access                            |
| Browser checks fail despite green health    | Guest-session creation, cookies, database access, correct base URL        | Use the browser preflight guidance in [Development and testing](development.md#browser-and-workflow-tests) |

Keep guest protections enabled. `GUEST_NETWORK_SECRET` must be stable and private. Enable `GUEST_TRUST_PROXY_IP` only when your trusted edge supplies the expected client-IP header and prevents callers from spoofing it.

Research has bounded per-source and overall deadlines. A slow or unavailable source should remain explicitly unavailable. Do not convert a timeout or unknown status into a priced, bookable offer.

## Demonstrate the booking experience

`BOOKING_DEMO_ENABLED=true` exposes the browser-only booking simulation. For an existing local Compose setup, update `.env` and recreate the web service:

```bash
docker compose --env-file .env -f infra/compose/compose.yml --profile infrastructure --profile applications up -d --force-recreate web
```

The demo does not call backend booking, payment, revalidation, or authorization endpoints. It creates no durable supplier confirmation and resets on reload. Existing trip-access checks still apply.

This flag changes the interface only. It does not activate supplier access, establish payment readiness, or bypass booking controls. Turn it off when validating the real booking path.

## Booking and recovery

Planning, saving a trip, and signing in do not authorize a purchase. Real supplier actions require fresh supported terms, exact-action consent, trusted payment or funding prerequisites, and verified operation access.

**Current whole-trip starts record a durable attempt and outbox intent without activating provider execution.** A completed review, accepted start request, or demo confirmation is not a real reservation.

The base local booking worker stays deterministic. When working on existing workflow infrastructure, start it after the main stack:

```bash
docker compose --env-file .env -f infra/compose/compose.yml --profile infrastructure --profile applications --profile booking up -d booking-worker
```

Deploy web and worker revisions with compatible schemas and adapters. For a host-run worker, `DATABASE_URL` must contain the worker-role URL. `WORKER_DATABASE_URL` in the template is a convenience value, not a variable the worker reads automatically.

### Preserve pricing integrity

A draft can show an authoritative customer total while part of the fee breakdown is still unknown. Booking cannot use that incomplete evidence and returns `409 price_breakdown_unverified`.

Keep internal supplier cost, customer price, fees, margin, and currency distinct. Do not fill missing fee evidence with zero, change a diagnostic fixture into booking authority, or bypass exact-term review.

### Reconcile uncertain outcomes

- Inspect the persisted transaction, component states, authorization, outbox event, and provider evidence together.
- Use an approved status operation before retrying an action with an uncertain outcome.
- Keep the original idempotency key and request fingerprint for the same action.
- Never infer confirmation from a timeout, an accepted request, or a workflow identifier.
- Do not retry an uncertain payment or provider write blindly.
- If status access is unavailable, escalate to manual provider confirmation rather than inventing a terminal result.
- Preserve partial successes. Cancellation or compensation is a separate supported and authorized action, not an automatic assumption.

Restoring an itinerary checkpoint changes the plan. It does not undo a booking or cancel supplier inventory.

## Retention and deletion

Raw conversation messages expire after 90 days. Access paths scrub expired messages, but inactive trips also need a separately scheduled call to `expireRawConversationMessages`. A daily scheduler is not deployed by default.

After 24 calendar months, trip, booking, authorization, and audit evidence become eligible for retention review, not automatic deletion. Honor legal holds and an approved deletion policy before removing that evidence.

The [retention implementation](../web/server/privacy/retention.ts) contains the lifecycle rules. Coordinate backups, deletion requests, and recovery procedures so restored data does not silently reintroduce records that should remain deleted.

For deployment, backups, and rollback, continue with the [production guide](../infra/production/README.md).
