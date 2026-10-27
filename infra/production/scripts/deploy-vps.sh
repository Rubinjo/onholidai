#!/usr/bin/env bash
# Deploy an onholidai release on the production VPS.
#
# Run from an uploaded release bundle. Shared state (environment file, Docker
# secret files, releases, backups) lives under the deploy root, never inside a
# release directory, so a release can be replaced atomically.
#
#   deploy-vps.sh [--build] [--env-stdin] [--skip-public-check]
#
#   --build            build web/agent images on this host instead of pulling
#                      immutable digests from the release manifest
#   --env-stdin        read the production environment from stdin (CI deploys)
#   --skip-public-check  do not require the public HTTPS probe to pass
set -euo pipefail
umask 077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
production_dir=$(cd -- "$script_dir/.." && pwd -P)
release_dir=$(cd -- "$production_dir/../.." && pwd -P)
deploy_root=${ONHOLIDAI_DEPLOY_ROOT:-/srv/onholidai}

build_local=false
env_mode=existing
public_check=true
for argument in "$@"; do
  case "$argument" in
    --build) build_local=true ;;
    --env-stdin) env_mode=stdin ;;
    --skip-public-check) public_check=false ;;
    *) echo "Unknown argument: $argument" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$production_dir/compose.yml" ]]; then
  echo "$production_dir/compose.yml is missing; this is not an onholidai release bundle." >&2
  exit 1
fi
mkdir -p -- "$deploy_root"
cd "$production_dir"

exec 9>"$deploy_root/.maintenance.lock"
flock --exclusive --wait 3600 9

env_source="$deploy_root/.env.production"
staged_env=
cleanup() {
  if [[ -n "$staged_env" ]]; then
    rm -f -- "$staged_env"
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

if [[ "$env_mode" == stdin ]]; then
  staged_env=$(mktemp "$deploy_root/.env.production.XXXXXX")
  # Normalize Windows line endings without interpreting shell syntax in secrets.
  sed 's/\r$//' > "$staged_env"
  env_source="$staged_env"
fi
if [[ ! -s "$env_source" ]] || ! grep -q '[^[:space:]]' "$env_source"; then
  echo 'PRODUCTION_ENV is missing or empty. The existing environment was not replaced.' >&2
  exit 1
fi
if grep -Eq '^[[:space:]]*(export[[:space:]]+)?VPS_PASSWORD[[:space:]]*=' "$env_source"; then
  echo 'Remove VPS_PASSWORD from the server application environment.' >&2
  exit 1
fi
chmod 600 "$env_source"

env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$env_source" | tail -n 1 | tr -d '\r'
}

secrets_dir=$(env_value SECRETS_DIR)
secrets_dir=${secrets_dir:-$deploy_root/secrets}
for secret in web_auth_secret service_token_secret pricing_diagnostic_secret; do
  if [[ ! -s "$secrets_dir/$secret.txt" ]]; then
    echo "Missing $secrets_dir/$secret.txt. Run bootstrap-vps.sh once on this host." >&2
    exit 1
  fi
done
db_passwords="$deploy_root/.db-passwords"
if [[ ! -s "$db_passwords" ]]; then
  echo "Missing $db_passwords. Run bootstrap-vps.sh once on this host." >&2
  exit 1
fi
export SECRETS_DIR="$secrets_dir"

app_domain=$(env_value APP_DOMAIN)

build_compose() {
  compose=(docker compose --env-file "$env_source" --env-file "$db_passwords" -p onholidai-production)
  if [[ "$build_local" == false ]]; then
    if [[ ! -s "$manifest" ]]; then
      echo 'Missing .release.env; deploy with --build for a registry-less installation.' >&2
      exit 1
    fi
    # Reject mutable tags and accidental local images before touching running services.
    for image_var in WEB_IMAGE AGENT_IMAGE; do
      grep -Eq "^${image_var}=ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$" "$manifest" || {
        echo "Missing immutable $image_var in release manifest." >&2
        exit 1
      }
    done
    compose+=(--env-file "$manifest")
  fi
  compose+=(-f "$production_dir/compose.yml")
  if [[ "$build_local" == true ]]; then
    compose+=(-f "$production_dir/compose.build.yml")
  fi
}

mkdir -p -- "$deploy_root/releases"
manifest="$release_dir/.release.env"
build_compose

# Parser diagnostics can contain secret values; report only a generic error.
if ! "${compose[@]}" config --quiet > /dev/null 2>&1; then
  echo 'Invalid production configuration. Check the environment file against .env.production.example.' >&2
  exit 1
fi

if [[ "$build_local" == true ]]; then
  echo 'Building application images on this host...'
  "${compose[@]}" build web agent
else
  # Pull everything before any service is replaced.
  "${compose[@]}" pull postgres temporal caddy web agent
fi

# The environment file is promoted only after the images are available locally.
if [[ -n "$staged_env" ]]; then
  mv -f -- "$staged_env" "$deploy_root/.env.production"
  staged_env=
  env_source="$deploy_root/.env.production"
  build_compose
fi

echo 'Validating the Caddy configuration...'
if ! "${compose[@]}" run --rm --no-deps -T --entrypoint caddy caddy \
    validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null; then
  echo 'Caddyfile validation failed; running services were left untouched.' >&2
  exit 1
fi

echo 'Starting the database and workflow engine...'
"${compose[@]}" up -d --wait --wait-timeout 300 postgres temporal

echo 'Applying schema migrations...'
"${compose[@]}" run --rm --no-deps -T migrate

echo 'Starting the application...'
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 600

"${compose[@]}" exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null

if [[ "$public_check" == true ]]; then
  if [[ -z "$app_domain" ]]; then
    echo 'APP_DOMAIN is not set in the environment file.' >&2
    exit 1
  fi
  if getent hosts "$app_domain" > /dev/null 2>&1; then
    echo "Verifying https://$app_domain ..."
    curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors \
      --connect-timeout 10 --max-time 30 "https://$app_domain/" > /dev/null
  else
    echo "Note: $app_domain does not resolve yet; skipped the public HTTPS probe."
  fi
fi

# Manual backup invocations resolve this link only after a successful deployment.
ln -sfn "$release_dir" "$deploy_root/.current-next"
mv -Tf "$deploy_root/.current-next" "$deploy_root/current"
if [[ -f "$deploy_root/current-release" ]]; then
  cp "$deploy_root/current-release" "$deploy_root/previous-release"
fi
printf '%s\n' "$release_dir" > "$deploy_root/current-release"

# Refresh the scheduled backup units from the release that just passed health checks.
if [[ -d "$production_dir/systemd" && -d /etc/systemd/system ]]; then
  install -m 644 "$production_dir/systemd/onholidai-backup.service" /etc/systemd/system/
  install -m 644 "$production_dir/systemd/onholidai-backup.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now onholidai-backup.timer > /dev/null
fi

# Keep the five most recent releases for rollback.
mapfile -t stale < <(find "$deploy_root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null |
  sort -n | head -n -5 | cut -d ' ' -f 2-)
for directory in "${stale[@]:-}"; do
  [[ -n "$directory" && "$directory" != "$release_dir" ]] && rm -rf -- "$directory"
done

echo "Deployed $release_dir"
