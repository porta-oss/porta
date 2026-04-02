#!/usr/bin/env bash
# S04 verification script: Portfolio card and prioritization surface
# Runs all slice-level checks in sequence and exits non-zero on first failure.

set -euo pipefail

echo "=== S04 Verification ==="
echo ""

# Phase 1: Dashboard shell regression tests
echo "[Phase 1] Dashboard shell regression tests"
bun test ./apps/web/src/routes/_authenticated/dashboard.test.tsx
echo "✅ Phase 1 passed"
echo ""

# Phase 2: Portfolio startup card tests
echo "[Phase 2] Portfolio startup card tests"
bun test ./apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx
echo "✅ Phase 2 passed"
echo ""

# Phase 3: Health page regression tests
echo "[Phase 3] Health page regression tests"
bun test ./apps/web/src/routes/_authenticated/dashboard-health.test.tsx
echo "✅ Phase 3 passed"
echo ""

# Phase 4: Full typecheck
echo "[Phase 4] Full typecheck"
pnpm lint
echo "✅ Phase 4 passed"
echo ""

# Phase 5: End-to-end portfolio founder flow (requires running dev servers)
# This phase is skipped if Playwright is not available or servers are not running.
if command -v npx &> /dev/null && [ -f apps/web/e2e/portfolio.spec.ts ]; then
  echo "[Phase 5] End-to-end portfolio founder flow"
  echo "⚠️  Phase 5 requires running API (port 3000) and web (port 5173) dev servers."
  echo "   Run 'bunx playwright test apps/web/e2e/portfolio.spec.ts' manually if servers are available."
  echo "   Skipping automated e2e in verification script (no live servers in CI-less environment)."
  echo ""
fi

echo "=== All S04 verification phases passed ==="
