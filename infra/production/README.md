<p align="center">
  <img src="../../web/public/logo/main_logo.svg" alt="OnHolidai" width="320" />
</p>

# Production deployment

Take OnHolidai from a local workspace to a single Ubuntu VPS with HTTPS, immutable application releases, separated database roles, and scheduled application backups.

This is the deployment runbook, not a blanket production-readiness claim. Live supplier access, payment readiness, recovery testing, and operational monitoring need their own verification.

[Project overview](../../README.md) | [Local setup](../../README.md#run-it-locally) | [Operations](../../docs/operations.md) | [Development and testing](../../docs/development.md)

## What runs on the host

The stack uses Docker Compose project `onholidai-production` under `/srv/onholidai`. Caddy handles public HTTPS and forwards requests to the web application. All other services stay on internal Docker networks.

| Service          | Public ports             | Role                                                 |
| ---------------- | ------------------------ | ---------------------------------------------------- |
| `caddy`          | 80/TCP, 443/TCP, 443/UDP | HTTPS and reverse proxy                              |
| `web`            | None                     | Next.js workspace and application APIs               |
| `agent`          | None                     | FastAPI planning agent                               |
| `booking-worker` | None                     | Temporal booking workflow worker                     |
| `temporal`       | None                     | Durable workflow orchestration                       |
| `postgres`       | None                     | PostgreSQL 18/PostGIS and role-separated persistence |
| `migrate`        | None                     | One-shot database migration job                      |

No Jaeger, Temporal UI, or OpenTelemetry collector is deployed by this stack. Configure an exporter endpoint only when a reachable collector exists.

## Before you provision

- Use a fresh Ubuntu VPS with root access and enough resources for the stack.
- Keep recovery-console access available while changing SSH and firewall settings.
- Point the apex and `www` DNS records at the host before enabling public HTTPS.
- Verify the SSH host fingerprint through a trusted channel.
- Keep production configuration and backups out of Git.
- Decide which live operations are actually verified before enabling them.

The bootstrap opens SSH on **port 22**. If your host uses a different SSH port, accommodate it deliberately before running the script so enabling the firewall does not lock you out.

## Provision the host once

Run from the repository root on your workstation, replacing the example hostname:

```bash
VPS_HOST=your-vps-host
scp infra/production/scripts/bootstrap-vps.sh "root@${VPS_HOST}:/root/bootstrap-vps.sh"
ssh "root@${VPS_HOST}" 'bash /root/bootstrap-vps.sh'
```

The [bootstrap script](scripts/bootstrap-vps.sh) installs Docker and Compose, adds swap, enables the firewall, fail2ban, and unattended security updates, and generates signing keys and database passwords.

Install the deployment public key in the authorized keys for the deployment account. Confirm key-based access from a second session before disabling password authentication. Docker management is privileged access, so protect the deployment key accordingly.

### Configure the environment

Create `/srv/onholidai/.env.production` from [the production template](.env.production.example), fill in the required values, and restrict it to mode `0600`.

Keep these files private:

| Location                         | Contents                                                |
| -------------------------------- | ------------------------------------------------------- |
| `/srv/onholidai/.env.production` | Runtime configuration and provider credentials          |
| `/srv/onholidai/.db-passwords`   | Generated role-specific database passwords              |
| `/srv/onholidai/secrets/*.txt`   | Authentication, service-token, and pricing signing keys |

Signing secrets must be explicit, distinct, and at least 32 characters. Keep the pricing-diagnostic key web-only. Match supplier credentials to the correct process and approved environment using the [operations guide](../../docs/operations.md#connect-live-travel-sources).

The deployment script merges `.db-passwords` into the Compose environment. Do not replace role separation with an application connection using the database administrator.

The checked-in schema is a clean-start baseline. Before the first deployment, `onholidai` must be empty; a database with the previous migration history is intentionally not upgraded. If one exists, recreate only the `onholidai` database before deploying. This removes its records but preserves PostgreSQL roles, credentials, the Temporal database, and other volume data. The migration job never drops data automatically.

From the release root, run this once on the VPS if it has the previous schema:

```bash
compose=(docker compose --env-file /srv/onholidai/.env.production --env-file /srv/onholidai/.db-passwords -p onholidai-production -f infra/production/compose.yml)
"${compose[@]}" up -d --wait postgres
"${compose[@]}" stop caddy web agent booking-worker
"${compose[@]}" exec -T postgres psql -U postgres -d postgres -c 'DROP DATABASE onholidai WITH (FORCE)'
"${compose[@]}" exec -T postgres psql -U postgres -d postgres -c 'CREATE DATABASE onholidai OWNER onholidai_migration'
"${compose[@]}" exec -T postgres psql -U postgres -d onholidai -c 'CREATE EXTENSION postgis'
"${compose[@]}" exec -T postgres psql -U postgres -d postgres -c 'REVOKE CONNECT ON DATABASE onholidai FROM PUBLIC'
"${compose[@]}" exec -T postgres psql -U postgres -d postgres -c 'GRANT CONNECT ON DATABASE onholidai TO onholidai_migration, onholidai_web, onholidai_worker'
```

## Deploy immutable releases

The [release workflow](../../.github/workflows/release.yml) builds and publishes the web and agent images on pushes to `main`. Publishing does **not** deploy them automatically.

To deploy, run the workflow manually on `main` and enable its `deploy` input. Configure these secrets in the GitHub `production` environment:

| Secret                             | Purpose                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `VPS_HOST`, `VPS_USER`, `VPS_PORT` | SSH endpoint and deployment account                    |
| `VPS_SSH_KEY`                      | Private deployment key supported by the workflow       |
| `VPS_KNOWN_HOSTS`                  | Host-key entry checked against the trusted fingerprint |
| `PRODUCTION_ENV`                   | Complete intended contents of `.env.production`        |

An unverified `ssh-keyscan` result is not host authentication. Verify the fingerprint independently before storing the known-hosts entry.

The workflow writes a release-local `.release.env` containing immutable `WEB_IMAGE` and `AGENT_IMAGE` digests. The deploy script rejects mutable image references for registry-based releases. Make the GHCR packages public or configure a narrowly scoped pull credential on the host.

The [deployment script](scripts/deploy-vps.sh):

1. Acquires the maintenance lock shared with backups.
2. Validates configuration and Caddy settings.
3. Pulls the pinned images and starts database/workflow dependencies.
4. Applies ordered migrations with the migration role.
5. Replaces application services and checks internal and public health.
6. Promotes the current-release pointer and retains the latest five release bundles.

Use this serialized path for migrations and release changes. Do not run ad hoc migration jobs alongside deployment or backup.

Host-built bootstrap releases use the script's explicit `--build` mode instead of a digest manifest. Prefer the workflow for routine releases. Never upload an unfiltered working directory containing local environment files, secret mounts, or build caches.

## Understand the host layout

```text
/srv/onholidai/
  .env.production
  .db-passwords
  secrets/
  releases/<release-id>/
    .release.env
    infra/production/
  current -> releases/<release-id>
  current-release
  previous-release
  backups/
  .maintenance.lock
```

`current` is a symlink. `current-release` and `previous-release` are text files containing release paths.

PostgreSQL and Caddy use named volumes independent of release bundles. Replacing an application release does not replace those volumes. Never use `docker compose down --volumes` as a routine repair or rollback step.

## Inspect a running release

Run on the VPS with privileges to read the root-only configuration. This helper targets the current workflow-managed release and includes its digest manifest:

```bash
onc() {
  docker compose \
    --env-file /srv/onholidai/.env.production \
    --env-file /srv/onholidai/.db-passwords \
    --env-file /srv/onholidai/current/.release.env \
    -f /srv/onholidai/current/infra/production/compose.yml \
    -p onholidai-production "$@"
}

onc ps
onc logs --tail 100 web agent booking-worker
systemctl status onholidai-backup.timer
```

Do not omit `.release.env`, which would allow image names to fall back to local defaults. A deliberately host-built bootstrap release without that manifest needs its own explicit build workflow.

Check the browser journey as well as service health. Keep logs and diagnostics free of credentials, payment tokens, and raw personal data. Review guest client-IP trust against the actual edge configuration before enabling proxy-header trust.

## Roll back application code

First confirm that the previous application revision supports the current database schema. Migrations are not automatically reversed, and a code rollback is not a database restore.

Read the path from `previous-release`, validate it, and redeploy that release through the same locked deployment script:

```bash
(
  set -euo pipefail
  previous_release="$(cat /srv/onholidai/previous-release)"
  if [ ! -d "$previous_release" ]
  then
    printf '%s\n' 'Previous release directory is unavailable.' >&2
    exit 1
  fi

  if [ -f "$previous_release/.release.env" ]
  then
    bash "$previous_release/infra/production/scripts/deploy-vps.sh"
  else
    bash "$previous_release/infra/production/scripts/deploy-vps.sh" --build
  fi
)
```

Use the `--build` branch only for a known host-built bootstrap release. Inspect service and public health after rollback and retain the incident evidence.

## Back up and verify recovery

The deployment installs [the backup timer](systemd/onholidai-backup.timer). It runs daily at **03:30 UTC**, with up to 15 minutes of randomized delay.

Run a backup on demand:

```bash
systemctl start onholidai-backup.service
journalctl -u onholidai-backup.service --no-pager -n 100
```

The [backup script](scripts/backup-vps.sh) shares the deployment lock, pauses running application writers, and arranges to restart them on exit. Expect a service interruption while those writers are stopped.

Each successful backup contains:

- A custom-format dump of the application `onholidai` database
- Production configuration and database passwords
- The signing-secret archive
- A `SHA256SUMS` manifest and a `COMPLETE` marker after structural checks

Local backups are retained for 14 days. They include credentials and must be treated as sensitive. Copy them to private off-host storage with a separately verified retention and access policy.

**The script does not back up Temporal databases or Caddy volumes.** It is an application backup, not complete disaster recovery. Archive listing, dump listing, and checksums also do not prove that a restore works.

Before relying on recovery:

1. Verify the `COMPLETE` marker and checksums.
2. Restore into an isolated recovery environment with matching PostgreSQL/PostGIS support.
3. Restore the matching configuration and signing secrets securely.
4. Choose application revisions compatible with the restored schema.
5. Account separately for Temporal persistence and uncertain supplier outcomes.
6. Test authentication, guest access, trip integrity, and booking reconciliation before reopening traffic.

Define and test the missing workflow-persistence and host-recovery procedures for your deployment. Do not resume uncertain supplier writes simply because the application database was restored.

## HTTPS and DNS

Set `APP_DOMAIN` for your deployment and point both the apex and `www` records at the VPS. Remove incorrect AAAA records if the host cannot serve IPv6.

The [Caddy configuration](Caddyfile) obtains and renews certificates automatically and redirects `www` to the apex domain.

For a temporary HTTP-only bring-up before DNS is ready, set `CADDYFILE=./Caddyfile.http-only` in `.env.production` and redeploy. Remove that override and redeploy once DNS is correct. Do not use the HTTP-only setup for real authentication, traveller data, or booking.
