#!/usr/bin/env bash
# verify-s06.sh — Repeatable slice verification for S06: Internal tasks and Linear sync
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════════════╗"
echo "║  S06 Verification: Internal Tasks & Linear Sync  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

PASS=0
FAIL=0

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

# ─── T01: Internal task API ───
echo "── T01: Internal task routes ──"
run_check "API route tests" bun test apps/api/tests/internal-task.routes.test.ts

# ─── T02: Worker task sync ───
echo ""
echo "── T02: Worker Linear sync ──"
run_check "Worker sync tests" bun test apps/worker/tests/linear-task-sync.worker.test.ts

# ─── T03: Dashboard UI ───
echo ""
echo "── T03: Dashboard task UI ──"
run_check "Dashboard task tests" bun test apps/web/src/routes/_authenticated/dashboard-task.test.tsx

# ─── Regressions ───
echo ""
echo "── Regression checks ──"
run_check "Insight route tests" bun test apps/api/tests/startup-insight.routes.test.ts
run_check "Dashboard insight tests" bun test apps/web/src/routes/_authenticated/dashboard-insight.test.tsx
run_check "Dashboard shell tests" bun test apps/web/src/routes/_authenticated/dashboard.test.tsx

# ─── Typecheck ───
echo ""
echo "── Type safety ──"
run_check "Full typecheck" bun run typecheck

echo ""
echo "══════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
