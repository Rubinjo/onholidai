#!/usr/bin/env bash
# One-time (idempotent) preparation of a fresh Ubuntu VPS for onholidai.
#
#   sudo ONHOLIDAI_DEPLOY_ROOT=/srv/onholidai ./bootstrap-vps.sh
#
# Installs Docker and the Compose plugin from the distribution, restricts
# inbound traffic to SSH/HTTP/HTTPS, adds swap for the Temporal + PostgreSQL +
# Next.js stack, enables unattended security upgrades, and generates the
# database/signing secrets the production stack mounts as Docker secrets.
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo 'Run bootstrap-vps.sh as root.' >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]] || ! grep -q '^ID=ubuntu' /etc/os-release; then
  echo 'This bootstrap supports Ubuntu only.' >&2
  exit 1
fi

deploy_root=${ONHOLIDAI_DEPLOY_ROOT:-/srv/onholidai}
secrets_dir="$deploy_root/secrets"
swap_size=${ONHOLIDAI_SWAP_SIZE:-4G}

echo '==> Installing packages'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl openssl ufw unattended-upgrades apt-listchanges fail2ban \
  docker.io docker-compose-v2

echo '==> Configuring the Docker daemon'
install -d -m 755 /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
JSON
systemctl enable --now docker
systemctl restart docker

echo '==> Adding swap'
if [[ -z "$(swapon --show --noheadings)" && ! -f /swapfile ]]; then
  fallocate -l "$swap_size" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-onholidai.conf
sysctl -q --system

echo '==> Configuring the firewall'
ufw --force default deny incoming > /dev/null
ufw --force default allow outgoing > /dev/null
ufw allow 22/tcp > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw allow 443/udp > /dev/null
ufw --force enable > /dev/null

echo '==> Enabling unattended security upgrades and SSH brute-force protection'
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now unattended-upgrades > /dev/null
cat > /etc/fail2ban/jail.d/onholidai.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
chmod 644 /etc/fail2ban/jail.d/onholidai.local
systemctl enable --now fail2ban > /dev/null

echo '==> Creating shared state directories'
install -d -m 700 "$deploy_root" "$deploy_root/releases" "$deploy_root/backups" "$secrets_dir"

echo '==> Generating credentials (existing files are kept)'
install -d -m 700 "$secrets_dir"
generate_secret() {
  local name=$1
  local file="$secrets_dir/$name.txt"
  if [[ -s "$file" ]]; then
    return
  fi
  (umask 077 && openssl rand -hex 32 > "$file")
  echo "    created $file"
}
# Signing secrets are mounted into the web/agent containers as Docker secrets.
for secret in web_auth_secret service_token_secret pricing_diagnostic_secret; do
  generate_secret "$secret"
done
chmod 600 "$secrets_dir"/*.txt

# Database passwords stay in a root-only environment file that the deploy script
# merges into the Compose invocation. PostgreSQL's init scripts run unprivileged
# and therefore cannot read root-only secret files.
db_passwords="$deploy_root/.db-passwords"
if [[ ! -s "$db_passwords" ]]; then
  (umask 077 && cat > "$db_passwords" <<EOF
POSTGRES_ADMIN_PASSWORD=$(openssl rand -hex 32)
APP_DB_PASSWORD=$(openssl rand -hex 32)
MIGRATION_DB_PASSWORD=$(openssl rand -hex 32)
TEMPORAL_DB_PASSWORD=$(openssl rand -hex 32)
WORKER_DB_PASSWORD=$(openssl rand -hex 32)
EOF
  )
  chmod 600 "$db_passwords"
  echo "    created $db_passwords"
fi

if [[ ! -f "$deploy_root/.env.production" ]]; then
  echo '==> Next step: install the production environment file'
  echo "    Copy infra/production/.env.production.example to $deploy_root/.env.production,"
  echo '    fill in the provider credentials, then run deploy-vps.sh.'
fi

echo '==> Bootstrap complete'
docker --version
docker compose version
