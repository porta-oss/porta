#!/usr/bin/env bash
# verify-s05.sh — Phased verification for S05: Grounded Insight Engine
# Phase 1: Shared contract + foundation tests (T01)
# Phase 2: Worker insight generation tests (T02)
# Phase 3: API route + dashboard render tests (T03)
set -euo pipefail

echo "╔══════════════════════════════════════════════╗"
echo "║   S05: Grounded Insight Engine — Verify      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

FAIL=0

# Phase 1: Foundation
echo "── Phase 1: Foundation (T01) ──"
if bun test apps/api/tests/startup-insight.foundation.test.ts 2>&1; then
  echo "✅ Foundation tests passed"
else
  echo "❌ Foundation tests FAILED"
  FAIL=1
fi
echo ""

# Phase 2: Worker insight generation
echo "── Phase 2: Worker Insight Generation (T02) ──"
if bun test apps/worker/tests/insight-generation.worker.test.ts 2>&1; then
  echo "✅ Worker insight generation tests passed"
else
  echo "❌ Worker insight generation tests FAILED"
  FAIL=1
fi
echo ""

# Phase 3: API route tests
echo "── Phase 3: API Route Tests (T03) ──"
if bun test apps/api/tests/startup-insight.routes.test.ts 2>&1; then
  echo "✅ API route tests passed"
else
  echo "❌ API route tests FAILED"
  FAIL=1
fi
echo ""

# Phase 4: Dashboard render tests
echo "── Phase 4: Dashboard Insight Render Tests (T03) ──"
if bun test apps/web/src/routes/_authenticated/dashboard-insight.test.tsx 2>&1; then
  echo "✅ Dashboard insight render tests passed"
else
  echo "❌ Dashboard insight render tests FAILED"
  FAIL=1
fi
echo ""

# Phase 5: Typecheck
echo "── Phase 5: Typecheck ──"
if bun run typecheck 2>&1; then
  echo "✅ Typecheck passed"
else
  echo "❌ Typecheck FAILED"
  FAIL=1
fi
echo ""

# Phase 6: Existing health tests (regression)
echo "── Phase 6: Health Test Regression ──"
if bun test apps/api/tests/startup-health.foundation.test.ts 2>&1; then
  echo "✅ Health foundation tests passed"
else
  echo "❌ Health foundation tests FAILED"
  FAIL=1
fi
echo ""

echo "═══════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ ALL S05 VERIFICATION PHASES PASSED"
else
  echo "❌ SOME S05 VERIFICATION PHASES FAILED"
  exit 1
fi
