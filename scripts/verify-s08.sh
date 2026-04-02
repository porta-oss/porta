#!/usr/bin/env bash
# verify-s08.sh — Repeatable slice verification for S08: Final integrated self-serve proof
#
# Starts API, web, and worker in founder-proof mode, checks /api/health
# diagnostics, runs the full founder browser proof, and stores phase-specific
# logs under tmp/verify-s08/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  S08 Verification: Final Integrated Self-Serve Proof      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

phase="bootstrap"
api_pid=""
web_pid=""
worker_pid=""
log_dir="tmp/verify-s08"
api_log="$log_dir/api.log"
web_log="$log_dir/web.log"
worker_log="$log_dir/worker.log"

PASS=0
FAIL=0

log() {
  printf '\n[verify:s08] [%s] %s\n' "$phase" "$1"
}

print_log_tail() {
  local label="$1"
  local path="$2"

  if [[ -f "$path" ]]; then
    printf '\n[verify:s08] [%s] Last 40 log lines from %s (%s):\n' "$phase" "$label" "$path"
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
  printf '\n[verify:s08] [%s] ❌ Verification failed with exit code %s.\n' "$phase" "$exit_code"
  print_log_tail "api" "$api_log"
  print_log_tail "web" "$web_log"
  print_log_tail "worker" "$worker_log"
  cleanup
  exit "$exit_code"
}

trap on_error ERR
trap cleanup EXIT

run_check() {
  local label="$1"
  shift
  echo -n "  [$label] "
  if "$@" > /dev/null 2>&1; then
    echo "✅ pass"
    PASS=$((PASS + 1))
  else
    echo "❌ fail"
    FAIL=$((FAIL + 1))
  fi
}

mkdir -p "$log_dir"

# ------------------------------------------------------------------
# Environment — founder-proof mode for API and Worker
# ------------------------------------------------------------------
export NODE_ENV="${NODE_ENV:-development}"
export API_PORT="${API_PORT:-3000}"
export API_URL="${API_URL:-http://localhost:3000}"
export WEB_PORT="${WEB_PORT:-5173}"
export WEB_URL="${WEB_URL:-http://localhost:5173}"
export VITE_API_URL="${VITE_API_URL:-$API_URL}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-$API_URL}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-0123456789abcdef0123456789abcdef}"
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export MAGIC_LINK_SENDER_EMAIL="${MAGIC_LINK_SENDER_EMAIL:-dev@founder-control-plane.local}"
export AUTH_CONTEXT_TIMEOUT_MS="${AUTH_CONTEXT_TIMEOUT_MS:-4000}"
export DATABASE_CONNECT_TIMEOUT_MS="${DATABASE_CONNECT_TIMEOUT_MS:-30000}"
export DATABASE_POOL_MAX="${DATABASE_POOL_MAX:-10}"
export CONNECTOR_ENCRYPTION_KEY="${CONNECTOR_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-$WEB_URL}"
export FOUNDER_PROOF_MODE="true"

wait_for_url() {
  local name="$1"
  local url="$2"
  local timeout_seconds="$3"
  local started_at
  started_at=$(date +%s)

  while true; do
    if curl --silent --show-error --fail "$url" > /dev/null; then
      printf '[verify:s08] [%s] %s is ready at %s\n' "$phase" "$name" "$url"
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      printf '[verify:s08] [%s] ⏰ Timed out waiting for %s at %s\n' "$phase" "$name" "$url"
      return 1
    fi

    sleep 1
  done
}

# ------------------------------------------------------------------
# Phase 1: Typecheck
# ------------------------------------------------------------------
phase="typecheck"
log "Running typecheck before starting the local runtime."
run_check "typecheck" pnpm lint

# ------------------------------------------------------------------
# Phase 2: Unit tests for founder-proof mode
# ------------------------------------------------------------------
phase="unit-tests"
log "Running T01 + T02 founder-proof unit tests."
run_check "api-proof-connectors" bun test apps/api/tests/founder-proof.connectors.test.ts
run_check "worker-proof-pipeline" bun test apps/worker/tests/founder-proof.worker.test.ts

# ------------------------------------------------------------------
# Phase 3: Start local stack in founder-proof mode
# ------------------------------------------------------------------
phase="servers"
log "Starting API, web, and worker runtimes with FOUNDER_PROOF_MODE=true."
log "Logs captured in $log_dir."

bun run dev:api > "$api_log" 2>&1 &
api_pid=$!

bun run dev:web > "$web_log" 2>&1 &
web_pid=$!

bun run dev:worker > "$worker_log" 2>&1 &
worker_pid=$!

# ------------------------------------------------------------------
# Phase 4: Readiness checks
# ------------------------------------------------------------------
phase="readiness"
wait_for_url "API health" "$API_URL/api/health" 45
wait_for_url "Web sign-in" "$WEB_URL/auth/sign-in" 45

# ------------------------------------------------------------------
# Phase 5: Health diagnostics assertion
# ------------------------------------------------------------------
phase="health-diagnostics"
log "Checking /api/health for founder-proof diagnostics."
health_payload=$(curl --silent --show-error --fail "$API_URL/api/health")
printf '[verify:s08] [%s] GET /api/health => %s\n' "$phase" "$health_payload"

# Assert founderProofMode is true in the health response
if echo "$health_payload" | grep -q '"founderProofMode":true'; then
  echo "  [health-founderProofMode] ✅ pass"
  PASS=$((PASS + 1))
else
  echo "  [health-founderProofMode] ❌ fail — founderProofMode not true in /api/health"
  FAIL=$((FAIL + 1))
fi

# Assert validation mode is founder-proof
if echo "$health_payload" | grep -q '"validationMode":"founder-proof"'; then
  echo "  [health-validationMode] ✅ pass"
  PASS=$((PASS + 1))
else
  echo "  [health-validationMode] ❌ fail — validationMode not founder-proof in /api/health"
  FAIL=$((FAIL + 1))
fi

# ------------------------------------------------------------------
# Phase 6: Browser proof
# ------------------------------------------------------------------
phase="playwright"
log "Running the full founder browser proof."
echo -n "  [founder-proof-e2e] "
if bunx playwright test apps/web/e2e/founder-proof.spec.ts 2>&1 | tee "$log_dir/playwright.log"; then
  echo "✅ pass"
  PASS=$((PASS + 1))
else
  echo "❌ fail"
  FAIL=$((FAIL + 1))
  print_log_tail "playwright" "$log_dir/playwright.log"
fi

# ------------------------------------------------------------------
# Phase 7: Regression checks
# ------------------------------------------------------------------
phase="regressions"
log "Running regression tests."
run_check "connector-routes" bun test apps/api/tests/connector.routes.test.ts
run_check "dashboard-shell" bun test apps/web/src/routes/_authenticated/dashboard.test.tsx

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
phase="complete"
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  S08 Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo "  ⚠️  Some checks failed. Review $log_dir for diagnostics."
  exit 1
fi

echo "  ✅ All S08 checks passed."
echo "  Logs: $log_dir"
exit 0
