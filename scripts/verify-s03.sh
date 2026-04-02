#!/usr/bin/env bash
# S03 verification script: B2B SaaS KPI template and startup health page
# Runs all slice-level checks in sequence and exits non-zero on first failure.

set -euo pipefail

echo "=== S03 Verification ==="
echo ""

# Phase 1: Shared contract + snapshot tests
echo "[Phase 1] Shared contract + persistence tests"
bun test ./apps/api/tests/startup-health.foundation.test.ts
echo "✅ Phase 1 passed"
echo ""

# Phase 2: API health route tests
echo "[Phase 2] API startup-health route tests"
bun test ./apps/api/tests/startup-health.routes.test.ts
echo "✅ Phase 2 passed"
echo ""

# Phase 3: Worker snapshot recompute tests
echo "[Phase 3] Worker sync + snapshot tests"
bun test ./apps/worker/tests/health-sync.worker.test.ts
echo "✅ Phase 3 passed"
echo ""

# Phase 4: Dashboard health render tests
echo "[Phase 4] Dashboard health page render tests"
bun test ./apps/web/src/routes/_authenticated/dashboard-health.test.tsx
echo "✅ Phase 4 passed"
echo ""

# Phase 5: Existing dashboard shell tests (regression)
echo "[Phase 5] Dashboard shell regression tests"
bun test ./apps/web/src/routes/_authenticated/dashboard.test.tsx
echo "✅ Phase 5 passed"
echo ""

# Phase 6: Typecheck
echo "[Phase 6] Full typecheck"
pnpm lint
echo "✅ Phase 6 passed"
echo ""

echo "=== All S03 verification phases passed ==="
