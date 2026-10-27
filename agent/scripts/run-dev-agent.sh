#!/bin/sh
# Runs an extra agent process inside the running agent container against the host dev
# server (web/scripts/dev-local.ps1) so provider changes can be tested without a rebuild.
# Usage:
#   docker cp agent/scripts/run-dev-agent.sh onholidai-agent-1:/tmp/dev.sh
#   docker exec -d onholidai-agent-1 /tmp/dev.sh [port] [webPort]
set -e
port="${1:-8002}"
web_port="${2:-3100}"
cd /workspace/agent
export SERVICE_TOKEN_SECRET="$(cat /run/secrets/service_token_secret)"
export WEB_BASE_URL="http://host.docker.internal:${web_port}"
exec .venv/bin/uvicorn onholidai_agent.api.main:app --host 0.0.0.0 --port "$port" \
  >> /tmp/dev-agent.log 2>&1
