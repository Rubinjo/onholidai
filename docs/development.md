<p align="center">
  <img src="../web/public/logo/main_logo.svg" alt="OnHolidai" width="320" />
</p>

# Development and testing

Build on OnHolidai with a repeatable local environment and checks that keep the workspace, agent, and travel integrations in sync.

For the fastest way to try the product, use the [Docker quickstart](../README.md#run-it-locally). This guide covers working on the code and validating your changes.

[Project overview](../README.md) | [Operations](operations.md) | [Shared contracts](../contracts/README.md) | [Deployment](../infra/production/README.md)

## Your development toolkit

| Tool                     | Supported version                      | Used for                                              |
| ------------------------ | -------------------------------------- | ----------------------------------------------------- |
| Node.js                  | 24                                     | Web application and tooling                           |
| pnpm                     | 12                                     | Locked JavaScript dependencies and workspace commands |
| Python                   | 3.13                                   | Planning agent                                        |
| uv                       | Compatible with the committed lockfile | Locked Python dependencies                            |
| Docker Compose           | v2, with Linux containers              | PostgreSQL/PostGIS, Temporal, and local observability |
| Bash, Git, OpenSSL, curl | Available in your shell                | Setup and diagnostic commands                         |

On Windows, run the Bash examples in Git Bash or WSL with Docker available in that shell.

Run commands from the repository root unless a step says otherwise:

```bash
pnpm install --frozen-lockfile
uv sync --project agent --frozen
```

Keep `PROVIDER_MODE=deterministic` for routine development. This uses synthetic model responses and supplier offers without paid API calls or real bookings. Use synthetic traveller and payment fixtures only.

## Run the applications with hot reload

First complete the configuration and Docker-secret steps in the [quickstart](../README.md#run-it-locally). Keep application containers stopped when running the same services on the host.

Start only the infrastructure:

```bash
docker compose --env-file .env -f infra/compose/compose.yml --profile infrastructure up -d
```

For host processes, check your local `.env` against these settings:

| Setting                           | Host-run value                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | PostgreSQL URL for `onholidai_web`, using the generated application database password |
| `MIGRATION_DATABASE_URL`          | PostgreSQL URL for `onholidai_migration`, using the generated migration password      |
| `TEMPORAL_ADDRESS`                | `localhost:7233`                                                                      |
| `AGENT_BASE_URL`                  | `http://localhost:8000`                                                               |
| `WEB_BASE_URL`, `BETTER_AUTH_URL` | `http://localhost:3000`                                                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | `http://localhost:4318`                                                               |

The database URLs use `localhost:5432/onholidai`. Docker creates the database roles on first initialization. Passwords must match the Docker secret files created during the [quickstart](../README.md#run-it-locally). The [environment template](../.env.example) explains the remaining settings.

Apply migrations with the migration role. Do not run this alongside another migration job:

```bash
(
  cd web
  node --env-file=../.env --experimental-strip-types server/db/migrate.ts
)
```

Start the agent in one terminal:

```bash
uv run --project agent uvicorn onholidai_agent.api.main:app --host 127.0.0.1 --port 8000 --reload
```

Start the web application in another terminal:

```bash
node --env-file=.env web/node_modules/next/dist/bin/next dev web
```

Open <http://localhost:3000>. Passing `--env-file` explicitly makes the repository-root configuration available to Node. The Python agent loads the root `.env` when started from this directory. Keep the same `SERVICE_TOKEN_SECRET` in both processes.

The booking worker is not needed for setup, planning, research, or account linking. Use the [operations guide](operations.md#booking-and-recovery) when working on booking workflows.

## Choose the smallest useful check

| Change                             | Start with                                              |
| ---------------------------------- | ------------------------------------------------------- |
| Documentation or formatting        | Prettier on the edited files                            |
| Web component or domain behavior   | The relevant Vitest file or test directory              |
| Agent behavior                     | The relevant pytest file                                |
| API, schema, or cross-service data | Contract checks and both contract suites                |
| Database behavior                  | An isolated database and the relevant integration suite |
| Browser journey                    | A focused Playwright project or test                    |

Examples:

```bash
pnpm --dir web exec prettier --check ../README.md ../docs/development.md
pnpm --dir web exec vitest run tests/unit/config.test.ts
uv run --project agent pytest agent/tests/contract
```

Before pushing, reproduce the CI formatting and Python type checks:

```bash
pnpm --filter @onholidai/web format:check
uv run --project agent pyright --project agent
```

The formatting command covers maintained source, configuration, and documentation across the repository. Use `pnpm format` to apply the existing Prettier and Black formatters.

Broader checks are available when your change needs them:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
```

`pnpm test` runs the web and agent suites. Some database-backed suites skip without isolated database configuration, so a green run with skipped tests does not establish database coverage. Empty test selections are errors.

## Test against a disposable database

Database tests must never use the application database, production credentials, or customer data. The helper creates a new database for each fixture and applies the full ordered migration set.

This Bash example starts a uniquely named, disposable PostGIS container, creates the synthetic test roles, runs the database foundation checks, and stops the container on exit. Environment changes stay inside the subshell:

```bash
(
  set -euo pipefail
  test_container="onholidai-test-$(openssl rand -hex 6)"
  docker run --detach --rm --name "$test_container" \
    --publish 127.0.0.1::5432 \
    --env POSTGRES_DB=postgres \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_PASSWORD=synthetic-admin \
    --tmpfs /var/lib/postgresql:rw \
    postgis/postgis:18-3.6
  trap 'docker stop "$test_container" >/dev/null' EXIT

  ready=false
  for attempt in {1..30}
  do
    if docker exec "$test_container" pg_isready -h 127.0.0.1 -U postgres -d postgres
    then
      ready=true
      break
    fi
    sleep 2
  done
  if [ "$ready" != true ]
  then
    printf '%s\n' 'Test PostgreSQL did not become ready.' >&2
    exit 1
  fi

  docker exec -i "$test_container" psql -U postgres -d postgres \
    --set ON_ERROR_STOP=1 < infra/postgres/test-roles.sql
  binding="$(docker port "$test_container" 5432/tcp)"
  port="${binding##*:}"
  export TEST_DATABASE_ADMIN_URL="postgresql://postgres:synthetic-admin@127.0.0.1:${port}/postgres"
  export TEST_DATABASE_MIGRATION_URL="postgresql://onholidai_migration:synthetic-migration@127.0.0.1:${port}/postgres"
  export TEST_DATABASE_APP_URL="postgresql://onholidai_web:synthetic-web@127.0.0.1:${port}/postgres"
  export TEST_DATABASE_WORKER_URL="postgresql://onholidai_worker:synthetic-worker@127.0.0.1:${port}/postgres"
  pnpm --dir web test:foundation
)
```

The foundation command requires all four URLs and fails if any are missing. To run another database-backed suite, replace the final test command inside the block with a focused Vitest selection. The fixture helper reports open connections instead of silently abandoning test databases.

## Browser and workflow tests

Playwright needs browser binaries and a dedicated, migrated application database:

```bash
pnpm --dir web exec playwright install --with-deps
pnpm --dir web exec playwright test --project=chromium
```

Supply a synthetic `DATABASE_URL` for that dedicated database and consistent authentication, service-token, and pricing-diagnostic secrets before starting the run. The test runner can start the deterministic agent and development web server, or reuse existing local services. Do not let it reuse your personal demo stack accidentally.

The [Playwright configuration](../web/playwright.config.ts) defines five desktop/mobile projects, managed-service settings, and optional base-URL overrides. CI uses a production build and disposable localhost TLS to exercise production cookies across browsers. Certificate exceptions are limited to that local test certificate, not live services.

Browser preflight checks real guest-session and database access as well as agent mode. A healthy web process is not enough. Fix failed preflight dependencies before increasing timeouts. Review local failure artifacts in [test results](../web/test-results/) when present.

Input-feedback tests enforce a 1,000 ms budget from the browser input event to visible feedback; Playwright actionability waits and assertion overhead are excluded. Run timing checks without concurrent builds or test suites competing for CPU/GPU. Use explicit future dates in calendar fixtures, and do not retry non-idempotent actions to mask missed input.

For the existing Temporal workflow suite:

```bash
pnpm test:temporal
```

Check the suite's prerequisites before running it. Synthetic workflow results do not prove live supplier access.

## Keep interfaces and visual assets in sync

- Follow the [shared contract guide](../contracts/README.md) when changing API shapes, booking terms, or supplier projections.
- Regenerate the branded architecture diagram using the instructions in the [project README](../README.md#development-and-validation).
- Review the [CI workflow](../.github/workflows/ci.yml) for the complete automated check matrix.

Keep live-provider verification separate from deterministic tests. Passing local checks does not establish commercial access, payment readiness, or production performance.
