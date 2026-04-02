#!/usr/bin/env bash
set -euo pipefail

phase="bootstrap"
api_pid=""
web_pid=""
worker_pid=""
log_dir="tmp/verify-s02"
api_log="$log_dir/api.log"
web_log="$log_dir/web.log"
worker_log="$log_dir/worker.log"

log() {
  printf '\n[verify:s02] [%s] %s\n' "$phase" "$1"
}

print_log_tail() {
  local label="$1"
  local path="$2"

  if [[ -f "$path" ]]; then
    printf '\n[verify:s02] [%s] Last log lines from %s (%s):\n' "$phase" "$label" "$path"
    tail -n 40 "$path" || true
  fi
}

cleanup() {
  for pid_var in web_pid api_pid worker_pid; do
    local pid="${!pid_var}"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}

on_error() {
  local exit_code=$?
  printf '\n[verify:s02] [%s] Verification failed with exit code %s.\n' "$phase" "$exit_code"
  print_log_tail "api" "$api_log"
  print_log_tail "web" "$web_log"
  print_log_tail "worker" "$worker_log"
  cleanup
  exit "$exit_code"
}

trap on_error ERR
trap cleanup EXIT

mkdir -p "$log_dir"

export NODE_ENV="${NODE_ENV:-development}"
export API_PORT="${API_PORT:-3000}"
export API_URL="${API_URL:-http://localhost:3000}"
export WEB_PORT="${WEB_PORT:-5173}"
export WEB_URL="${WEB_URL:-http://localhost:5173}"
export VITE_API_URL="${VITE_API_URL:-$API_URL}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-$API_URL}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-0123456789abcdef0123456789abcdef}"
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/porta}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export MAGIC_LINK_SENDER_EMAIL="${MAGIC_LINK_SENDER_EMAIL:-dev@porta.local}"
export AUTH_CONTEXT_TIMEOUT_MS="${AUTH_CONTEXT_TIMEOUT_MS:-4000}"
export DATABASE_CONNECT_TIMEOUT_MS="${DATABASE_CONNECT_TIMEOUT_MS:-30000}"
export DATABASE_POOL_MAX="${DATABASE_POOL_MAX:-10}"
export CONNECTOR_ENCRYPTION_KEY="${CONNECTOR_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-$WEB_URL}"

wait_for_url() {
  local name="$1"
  local url="$2"
  local timeout_seconds="$3"
  local started_at
  started_at=$(date +%s)

  while true; do
    if curl --silent --show-error --fail "$url" > /dev/null; then
      printf '[verify:s02] [%s] %s is ready at %s\n' "$phase" "$name" "$url"
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      printf '[verify:s02] [%s] Timed out waiting for %s at %s\n' "$phase" "$name" "$url"
      return 1
    fi

    sleep 1
  done
}

# ------------------------------------------------------------------
# Phase 1: Contract tests
# ------------------------------------------------------------------
phase="contracts"
log "Running API, worker, and web contract tests before starting the local runtime."
bun test \
  apps/api/tests/connector.foundation.test.ts \
  apps/api/tests/connector.routes.test.ts \
  apps/api/tests/connector.integration.test.ts \
  apps/worker/tests/sync.worker.test.ts \
  apps/web/src/routes/_authenticated/onboarding.test.tsx \
  apps/web/src/routes/_authenticated/dashboard.test.tsx

# ------------------------------------------------------------------
# Phase 2: Start local stack
# ------------------------------------------------------------------
phase="servers"
log "Starting API, web, and worker runtimes with captured logs in $log_dir."
bun run dev:api > "$api_log" 2>&1 &
api_pid=$!
bun run dev:web > "$web_log" 2>&1 &
web_pid=$!
# Only start worker if dev:worker script exists
if grep -q '"dev:worker"' package.json 2>/dev/null; then
  bun run dev:worker > "$worker_log" 2>&1 &
  worker_pid=$!
fi

# ------------------------------------------------------------------
# Phase 3: Readiness checks
# ------------------------------------------------------------------
phase="readiness"
wait_for_url "API health" "$API_URL/api/health" 45
wait_for_url "Web sign-in" "$WEB_URL/auth/sign-in" 45

# ------------------------------------------------------------------
# Phase 4: Health + observability surface checks
# ------------------------------------------------------------------
phase="health"
log "Checking the API health payload for connector and sync observability surfaces."
health_payload=$(curl --silent --show-error --fail "$API_URL/api/health")
printf '[verify:s02] [%s] GET /api/health => %s\n' "$phase" "$health_payload"

# ------------------------------------------------------------------
# Phase 5: Browser flow
# ------------------------------------------------------------------
phase="playwright"
log "Running the connector browser flow with traces and screenshots retained on failure."
bun run test:e2e:connectors

# ------------------------------------------------------------------
# Phase 6: Done
# ------------------------------------------------------------------
phase="complete"
log "Slice S02 verification passed. Review $log_dir for server logs if you need boot evidence."
