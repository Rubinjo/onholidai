# Production deployment

The production host is a single Ubuntu VPS running one Docker Compose project,
`onholidai-production`, under `/srv/onholidai`. Caddy terminates TLS for
`onholidai.nl`, and every other service stays on internal Docker networks.

| Service          | Published | Purpose                                                             |
| ---------------- | --------- | ------------------------------------------------------------------- |
| `caddy`          | 80, 443   | TLS termination and reverse proxy for `web:3000`                    |
| `web`            | —         | Next.js application and API routes                                  |
| `agent`          | —         | FastAPI planning agent (`agent:8000`)                               |
| `booking-worker` | —         | Temporal worker for booking workflows                               |
| `temporal`       | —         | Workflow engine; persistence in `postgres`                          |
| `postgres`       | —         | PostgreSQL 18 with PostGIS, role separation as in local development |
| `migrate`        | —         | One-shot migration job, started by the deploy script                |

No observability stack is deployed. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at a
collector only after one exists.

## Host layout

```text
/srv/onholidai/
  .env.production        # non-secret configuration + provider credentials (0600)
  .db-passwords          # generated database passwords, merged by the deploy script (0600)
  secrets/*.txt          # Docker secrets: auth, service-token and pricing signing keys
  releases/<id>/         # immutable release bundles
  current -> releases/<id>
  backups/               # verified backups, 14-day retention
  .maintenance.lock      # flock target shared by deploy and backup
```

PostgreSQL, Temporal and Caddy data live in named volumes
(`onholidai-production_postgres-data`, `-caddy-data`, `-caddy-config`). A release
can be deleted and redeployed without touching them.

## First provision

1. Run the bootstrap once as root on the fresh VPS:

   ```bash
   scp infra/production/scripts/bootstrap-vps.sh root@<host>:/root/
   ssh root@<host> 'bash /root/bootstrap-vps.sh'
   ```

   It installs Docker/Compose from Ubuntu, adds 4 GB of swap, enables
   `ufw` (22/80/443 only), `fail2ban`, unattended security upgrades, and
   generates the signing secrets plus `/srv/onholidai/.db-passwords`.
   Database passwords are deliberately kept in a separate root-only file: the
   PostgreSQL init scripts run unprivileged and Compose cannot lower secret file
   modes outside Swarm, so the deploy script merges that file into the Compose
   environment instead. Keep `.db-passwords` with the backups when restoring.

2. Install the deploy key in `/root/.ssh/authorized_keys`, confirm key-based
   login works, then disable password authentication
   (`PasswordAuthentication no`, `PermitRootLogin prohibit-password` in
   `/etc/ssh/sshd_config.d/`).

3. Create `/srv/onholidai/.env.production` from
   [`.env.production.example`](./.env.production.example) and fill in the
   provider credentials. Keep it mode 0600 and never commit it.

4. Deploy. Either run the release workflow (below), or build on the host once
   from a copy of the repository:

   ```bash
   rsync -a --exclude .git --exclude node_modules ./ root@<host>:/srv/onholidai/releases/bootstrap/
   ssh root@<host> 'bash /srv/onholidai/releases/bootstrap/infra/production/scripts/deploy-vps.sh --build'
   ```

## Continuous deployment

`.github/workflows/release.yml` builds `ghcr.io/rubinjo/onholidai-web` and
`ghcr.io/rubinjo/onholidai-agent` on every push to `main`, and deploys an
immutable digest pair when dispatched manually.

Required repository/environment secrets for the `production` environment:

| Secret                             | Value                                             |
| ---------------------------------- | ------------------------------------------------- |
| `VPS_HOST`, `VPS_USER`, `VPS_PORT` | SSH endpoint of the VPS                           |
| `VPS_SSH_KEY`                      | private key of the deploy keypair (no passphrase) |
| `VPS_KNOWN_HOSTS`                  | `ssh-keyscan -p <port> <host>` output             |
| `PRODUCTION_ENV`                   | full contents of `/srv/onholidai/.env.production` |

The workflow writes `.release.env` with the two image digests; `deploy-vps.sh`
refuses anything that is not `ghcr.io/...@sha256:...`, so a mutable tag can
never reach the host.

Registry authentication: the GHCR packages must be public, or the host must hold
a pull credential (`docker login ghcr.io` as root, stored in
`/root/.docker/config.json`).

## Routine operations

```bash
cd /srv/onholidai/current/infra/production
alias onc='docker compose --env-file /srv/onholidai/.env.production --env-file /srv/onholidai/.db-passwords -p onholidai-production'

onc ps
onc logs --tail 100 web agent
onc run --rm migrate
```

Backups run daily at 03:30 UTC through `onholidai-backup.timer`; the deploy
script installs and enables the unit. Run one on demand with
`systemctl start onholidai-backup.service` or
`/srv/onholidai/current/infra/production/scripts/backup-vps.sh`.

Rollback repoints the symlink and redeploys the previous release:

```bash
cat /srv/onholidai/previous-release
bash /srv/onholidai/previous-release/infra/production/scripts/deploy-vps.sh
```

The migration checksums are version-ordered, so only roll back application code
after confirming the previous release supports the current schema.

## HTTPS and DNS

`Caddyfile` requests certificates automatically. Until `onholidai.nl` and
`www.onholidai.nl` resolve to this host, point them at the VPS A/AAAA records;
Caddy retries issuance without operator action. For a temporary HTTP-only
bring-up before DNS exists, set `CADDYFILE=./Caddyfile.http-only` in
`.env.production` and redeploy; remove the line once the records are live.
