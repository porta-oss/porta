#!/usr/bin/env bash
# Porta — Self-host compose/browser verifier for M002/S02
#
# Brings up the full Docker Compose stack, validates service health,
# runs browser smoke tests against localhost, and prints diagnostics.
#
# Usage: bash scripts/verify-m002-s02.sh
# Exit 0 = all checks pass, non-zero = failure with diagnostics.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

COMPOSE_TIMEOUT=120
HEALTH_RETRIES=30
HEALTH_INTERVAL=4

log()  { printf "${CYAN}[verify]${NC} %s\n" "$*"; }
pass() { printf "${GREEN}  ✓${NC} %s\n" "$*"; }
fail() { printf "${RED}  ✗${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}  ⚠${NC} %s\n" "$*"; }

cleanup() {
  log "Tearing down compose stack..."
  docker compose down --timeout 10 2>/dev/null || true
}

print_diagnostics() {
  log "=== DIAGNOSTICS ==="
  echo ""
  log "docker compose ps:"
  docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
  echo ""

  for svc in api web worker postgres redis; do
    log "Last 15 lines from $svc:"
    docker compose logs --tail=15 "$svc" 2>/dev/null || warn "Could not fetch logs for $svc"
    echo ""
  done
}

ERRORS=0

# ── Phase 1: Compose .env check ─────────────────────────────────────────
log "Phase 1: Checking compose environment..."

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    warn "No .env found — copying .env.example to .env for compose verification"
    cp .env.example .env
  else
    fail ".env and .env.example are both missing"
    exit 1
  fi
fi

# Ensure required secrets have non-placeholder values or defaults
source .env 2>/dev/null || true
if [ -z "${BETTER_AUTH_SECRET:-}" ] || [ "$BETTER_AUTH_SECRET" = "replace-with-a-local-secret-at-least-32-characters-long" ]; then
  warn "BETTER_AUTH_SECRET is a placeholder — setting a random value for verification"
  export BETTER_AUTH_SECRET
  BETTER_AUTH_SECRET="verify-$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)"
  # Write it to .env so docker compose picks it up
  if grep -q '^BETTER_AUTH_SECRET=' .env 2>/dev/null; then
    sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}|" .env
    rm -f .env.bak
  else
    echo "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}" >> .env
  fi
fi

pass "Compose .env ready"

# ── Phase 2: Build and start compose stack ───────────────────────────────
log "Phase 2: Building and starting compose stack..."
trap print_diagnostics ERR
trap cleanup EXIT

docker compose down --timeout 10 2>/dev/null || true
docker compose build --quiet 2>&1 || {
  fail "docker compose build failed"
  print_diagnostics
  exit 1
}
pass "Images built"

docker compose up -d 2>&1 || {
  fail "docker compose up failed"
  print_diagnostics
  exit 1
}
pass "Compose stack started"

# ── Phase 3: Wait for all services to be healthy ────────────────────────
log "Phase 3: Waiting for service health (timeout ${COMPOSE_TIMEOUT}s)..."

wait_for_service() {
  local service=$1
  local retries=$2
  local interval=$3
  for i in $(seq 1 "$retries"); do
    status=$(docker compose ps --format json "$service" 2>/dev/null | head -1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health','unknown'))" 2>/dev/null || echo "unknown")
    if [ "$status" = "healthy" ]; then
      pass "$service is healthy"
      return 0
    fi
    sleep "$interval"
  done
  fail "$service did not become healthy after $((retries * interval))s (last status: $status)"
  return 1
}

wait_for_service postgres "$HEALTH_RETRIES" "$HEALTH_INTERVAL" || ERRORS=$((ERRORS + 1))
wait_for_service redis "$HEALTH_RETRIES" "$HEALTH_INTERVAL" || ERRORS=$((ERRORS + 1))
wait_for_service api "$HEALTH_RETRIES" "$HEALTH_INTERVAL" || ERRORS=$((ERRORS + 1))
wait_for_service web "$HEALTH_RETRIES" "$HEALTH_INTERVAL" || ERRORS=$((ERRORS + 1))

# Worker doesn't have a healthcheck in the same way — just check it's running
worker_status=$(docker compose ps --format json worker 2>/dev/null | head -1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('State','unknown'))" 2>/dev/null || echo "unknown")
if [ "$worker_status" = "running" ]; then
  pass "worker is running"
else
  fail "worker is not running (state: $worker_status)"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  fail "$ERRORS service(s) failed health check"
  print_diagnostics
  exit 1
fi

# ── Phase 4: API health endpoint check ──────────────────────────────────
log "Phase 4: Checking /api/health..."

HEALTH_RESPONSE=$(curl -sf http://localhost:3000/api/health 2>/dev/null || curl -sf http://localhost/api/health 2>/dev/null || echo "FAIL")

if [ "$HEALTH_RESPONSE" = "FAIL" ]; then
  fail "/api/health is not reachable"
  print_diagnostics
  exit 1
fi

echo "$HEALTH_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'  status:  {data.get(\"status\", \"??\")}')
print(f'  edition: {data.get(\"edition\", \"??\")}')
print(f'  db configured: {data.get(\"database\", {}).get(\"configured\", \"??\")}')
print(f'  connectors key: {data.get(\"connectors\", {}).get(\"encryptionKeyConfigured\", \"??\")}')
" 2>/dev/null || warn "Could not parse health response"

# Check no secrets leaked
if echo "$HEALTH_RESPONSE" | grep -qE 'BETTER_AUTH_SECRET|CONNECTOR_ENCRYPTION_KEY|postgres:' 2>/dev/null; then
  fail "Health response leaks secrets!"
  ERRORS=$((ERRORS + 1))
else
  pass "/api/health is clean (no secret leakage)"
fi

pass "/api/health is reachable and reports diagnostics"

# ── Phase 5: localhost sign-in page check ────────────────────────────────
log "Phase 5: Checking localhost sign-in page..."

SIGNIN_RESPONSE=$(curl -sf http://localhost/auth/sign-in 2>/dev/null || curl -sf http://localhost/ 2>/dev/null || echo "FAIL")

if [ "$SIGNIN_RESPONSE" = "FAIL" ]; then
  fail "http://localhost is not reachable"
  print_diagnostics
  exit 1
fi

if echo "$SIGNIN_RESPONSE" | grep -qi 'html' 2>/dev/null; then
  pass "http://localhost serves HTML content"
else
  fail "http://localhost did not return HTML"
  ERRORS=$((ERRORS + 1))
fi

# ── Phase 6: Compose state summary ──────────────────────────────────────
log "Phase 6: Final compose state"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

echo ""
if [ "$ERRORS" -gt 0 ]; then
  fail "Verification completed with $ERRORS error(s)"
  print_diagnostics
  exit 1
fi

pass "All self-host runtime checks passed"
log "Verification complete — the compose stack is healthy and localhost is reachable."
exit 0
