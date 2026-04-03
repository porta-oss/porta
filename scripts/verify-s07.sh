#!/usr/bin/env bash
# verify-s07.sh — Repeatable slice verification for S07: Optional Postgres custom metric path
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "╔═════════════════════════════════════════════════════════════╗"
echo "║  S07 Verification: Optional Postgres Custom Metric Path    ║"
echo "╚═════════════════════════════════════════════════════════════╝"
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

# ─── Phase 1: Typecheck ───
echo "── Phase 1: Typecheck ──"
run_check "typecheck" bun run typecheck

# ─── Phase 2: T01 — Postgres setup API ───
echo ""
echo "── Phase 2: T01 — Postgres setup API ──"
run_check "postgres-setup-api" bun test apps/api/tests/postgres-custom-metric.setup.test.ts
run_check "connector-routes-regression" bun test apps/api/tests/connector.routes.test.ts

# ─── Phase 3: T02 — Worker sync and health API ───
echo ""
echo "── Phase 3: T02 — Worker sync & health API ──"
run_check "postgres-worker-sync" bun test apps/worker/tests/postgres-custom-metric.worker.test.ts
run_check "postgres-health-api" bun test apps/api/tests/postgres-custom-metric.health.test.ts

# ─── Phase 4: T03 — Dashboard UI ───
echo ""
echo "── Phase 4: T03 — Dashboard postgres metric UI ──"
run_check "dashboard-postgres-metric" bun test apps/web/src/routes/_authenticated/dashboard-postgres-metric.test.tsx
run_check "dashboard-health-regression" bun test apps/web/src/routes/_authenticated/dashboard-health.test.tsx
run_check "onboarding-regression" bun test apps/web/src/routes/_authenticated/onboarding.test.tsx
run_check "dashboard-shell-regression" bun test apps/web/src/routes/_authenticated/dashboard.test.tsx

# ─── Phase 5: Foundation regressions ───
echo ""
echo "── Phase 5: Foundation regressions ──"
run_check "connector-foundation" bun test apps/api/tests/connector.foundation.test.ts
run_check "dashboard-portfolio" bun test apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx

# ─── Summary ───
echo ""
echo "════════════════════════════════════════"
echo "  S07 Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo "  ⚠️  Some checks failed. Review the output above."
  exit 1
fi

echo "  ✅ All S07 checks passed."
exit 0
