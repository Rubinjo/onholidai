#!/usr/bin/env bash
# Consistent on-host backup of the production stack.
#
#   ./backup-vps.sh [backup-root]      # default: /srv/onholidai/backups
#
# Keeps 14 days of backups and verifies each archive before reporting success.
# Copy completed directories to private off-server storage; they contain the
# database dump and the production credentials.
set -euo pipefail
umask 077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
release_dir=$(cd -- "$script_dir/../../.." && pwd -P)
deploy_root=${ONHOLIDAI_DEPLOY_ROOT:-/srv/onholidai}
backup_root=${1:-$deploy_root/backups}
env_file="$deploy_root/.env.production"

if [[ ! -s "$env_file" ]]; then
  echo "Missing $env_file" >&2
  exit 1
fi

compose=(docker compose --env-file "$env_file" --env-file "$deploy_root/.db-passwords" -p onholidai-production -f "$release_dir/infra/production/compose.yml")

exec 9>"$deploy_root/.maintenance.lock"
flock --exclusive --wait 86400 9

mkdir -p -- "$backup_root"
chmod 700 "$backup_root"
backup_dir=$(mktemp -d "$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
chmod 700 "$backup_dir"

# Restart exactly the services that were running, including after a failed backup.
running=$("${compose[@]}" ps --services --status running)
writers=()
while IFS= read -r service; do
  case "$service" in web|booking-worker|agent) writers+=("$service") ;; esac
done <<< "$running"
restart_writers() {
  if ((${#writers[@]})); then
    "${compose[@]}" start "${writers[@]}" > /dev/null
  fi
}
trap restart_writers EXIT
if ((${#writers[@]})); then
  "${compose[@]}" stop -t 60 "${writers[@]}" > /dev/null
fi

"${compose[@]}" exec -T postgres pg_dump -U postgres -d onholidai -Fc > "$backup_dir/database.dump"
"${compose[@]}" exec -T postgres pg_restore --list < "$backup_dir/database.dump" > /dev/null

install -m 600 -- "$env_file" "$backup_dir/env.production"
install -m 600 -- "$deploy_root/.db-passwords" "$backup_dir/db-passwords"
tar -czf "$backup_dir/secrets.tar.gz" -C "$deploy_root" secrets
tar -tzf "$backup_dir/secrets.tar.gz" > /dev/null

(cd -- "$backup_dir" && sha256sum database.dump env.production db-passwords secrets.tar.gz > SHA256SUMS)
touch "$backup_dir/COMPLETE"

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
printf 'Backup complete: %s\nCopy this directory to private off-server storage.\n' "$backup_dir"
