#!/usr/bin/env bash
# verify-m002-s03.sh — M002/S03 slice verification: Railway template, public repo, and docs
# Named-phase verifier. Exit on first failure within a phase, report named failures.
#
# All phases are strict — missing or incomplete artifacts fail the check.

set -euo pipefail

FAIL=0
PASS=0

pass() { ((PASS++)); printf '  ✅ %s\n' "$1"; }
fail() { ((FAIL++)); printf '  ❌ %s\n' "$1"; }

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1: Runtime contract — /api/health alpha maturity
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "── Phase 1: Runtime contract — alpha maturity ──"
echo ""

# 1a. Run the dedicated alpha health tests
if [ -f apps/api/tests/runtime-health.alpha.test.ts ]; then
  if bun test apps/api/tests/runtime-health.alpha.test.ts 2>&1; then
    pass "Alpha health tests pass"
  else
    fail "Alpha health tests failed"
  fi
else
  fail "apps/api/tests/runtime-health.alpha.test.ts is missing"
fi

# 1b. Verify the health endpoint source contains release metadata
if grep -q '"porta"' apps/api/src/app.ts && grep -q '"alpha"' apps/api/src/app.ts; then
  pass "app.ts contains Porta alpha release metadata"
else
  fail "app.ts is missing Porta alpha release metadata"
fi

# 1c. Check secret redaction — no raw secret patterns in health route
if grep -q 'betterAuthSecret' apps/api/src/app.ts; then
  HEALTH_SECTION=$(sed -n '/\.get("\/health"/,/^    })/p' apps/api/src/app.ts)
  if echo "$HEALTH_SECTION" | grep -q 'betterAuthSecret\|databaseUrl\|redisUrl\|connectorEncryptionKey'; then
    fail "Health route may leak secrets — found secret field references in health handler"
  else
    pass "Health route does not reference secret fields"
  fi
else
  pass "Health route does not reference secret fields"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Phase 2: Docs — self-hosting guide
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "── Phase 2: Docs — self-hosting guide ──"
echo ""

if [ -f docs/self-hosting.md ]; then
  pass "docs/self-hosting.md exists"
else
  fail "docs/self-hosting.md is missing"
fi

if [ -f docs/self-hosting.md ]; then
  if grep -qi "Docker Compose" docs/self-hosting.md; then
    pass "docs/self-hosting.md covers Docker Compose path"
  else
    fail "docs/self-hosting.md is missing Docker Compose section"
  fi

  if grep -qi "Railway" docs/self-hosting.md; then
    pass "docs/self-hosting.md covers Railway path"
  else
    fail "docs/self-hosting.md is missing Railway section"
  fi

  if grep -q "BETTER_AUTH_SECRET" docs/self-hosting.md; then
    pass "docs/self-hosting.md references BETTER_AUTH_SECRET"
  else
    fail "docs/self-hosting.md is missing BETTER_AUTH_SECRET reference"
  fi

  if grep -q "CONNECTOR_ENCRYPTION_KEY" docs/self-hosting.md; then
    pass "docs/self-hosting.md references CONNECTOR_ENCRYPTION_KEY"
  else
    fail "docs/self-hosting.md is missing CONNECTOR_ENCRYPTION_KEY reference"
  fi

  if grep -qi "Troubleshoot" docs/self-hosting.md; then
    pass "docs/self-hosting.md has troubleshooting section"
  else
    fail "docs/self-hosting.md is missing troubleshooting section"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Phase 3: Railway config
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "── Phase 3: Railway config ──"
echo ""

RAILWAY_FILES=("apps/api/railway.toml" "apps/web/railway.toml" "apps/worker/railway.toml")

for rf in "${RAILWAY_FILES[@]}"; do
  if [ -f "$rf" ]; then
    pass "$rf exists"
  else
    fail "$rf is missing"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════
# Phase 4: Community artifacts
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "── Phase 4: Community artifacts ──"
echo ""

COMMUNITY_FILES=(
  "CONTRIBUTING.md"
  "CODE_OF_CONDUCT.md"
  "SECURITY.md"
  ".github/ISSUE_TEMPLATE/bug_report.yml"
  ".github/ISSUE_TEMPLATE/feature_request.yml"
  ".github/ISSUE_TEMPLATE/config.yml"
  ".github/DISCUSSION_TEMPLATE/q-a.yml"
)

for cf in "${COMMUNITY_FILES[@]}"; do
  if [ -f "$cf" ]; then
    pass "$cf exists"
  else
    fail "$cf is missing"
  fi
done

# Content checks on community files
if [ -f CONTRIBUTING.md ]; then
  if grep -qi "alpha\|community" CONTRIBUTING.md; then
    pass "CONTRIBUTING.md references alpha/community boundaries"
  else
    fail "CONTRIBUTING.md is missing alpha/community references"
  fi
fi

if [ -f SECURITY.md ]; then
  if grep -qi "security\|disclosure\|private" SECURITY.md; then
    pass "SECURITY.md covers disclosure process"
  else
    fail "SECURITY.md is missing disclosure process"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Phase 5: README — public landing page
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "── Phase 5: README — public landing page ──"
echo ""

if [ ! -f README.md ]; then
  fail "README.md is missing"
else
  pass "README.md exists"

  # Required sections
  if grep -qi "What is Porta" README.md; then
    pass "README has product description"
  else
    fail "README is missing product description section"
  fi

  if grep -qi "Architecture" README.md; then
    pass "README has architecture overview"
  else
    fail "README is missing architecture overview"
  fi

  if grep -qi "Quick Start\|Quickstart\|Getting Started" README.md; then
    pass "README has quickstart section"
  else
    fail "README is missing quickstart section"
  fi

  if grep -qi "Alpha" README.md; then
    pass "README has alpha maturity callout"
  else
    fail "README is missing alpha maturity callout"
  fi

  if grep -qi "AGPL\|License" README.md; then
    pass "README has license section"
  else
    fail "README is missing license section"
  fi

  if grep -qi "Trademark" README.md; then
    pass "README has trademark notice"
  else
    fail "README is missing trademark notice"
  fi

  if grep -qi "Contributing" README.md; then
    pass "README links to Contributing"
  else
    fail "README is missing Contributing link"
  fi

  if grep -qi "Community\|Discussions" README.md; then
    pass "README has community section"
  else
    fail "README is missing community section"
  fi

  # Railway deploy button — must be a railway.com/template link, not a docs page
  if grep -q 'railway.com/button.svg' README.md; then
    pass "README has Railway deploy button badge"
  else
    fail "README is missing Railway deploy button badge"
  fi

  if grep -q 'railway.com/template/' README.md; then
    pass "README deploy button points to a Railway template URL"
  else
    fail "README deploy button does not point to a Railway template URL — fix before release"
  fi

  # Verify linked files exist
  README_LINKS=(
    "docs/self-hosting.md"
    "FEATURES.md"
    "CONTRIBUTING.md"
    "CODE_OF_CONDUCT.md"
    "SECURITY.md"
    "LICENSE"
  )

  for link in "${README_LINKS[@]}"; do
    if [ -f "$link" ]; then
      pass "README link target exists: $link"
    else
      fail "README links to $link but file is missing"
    fi
  done

  # docker-compose reference
  if grep -qi "docker.compose" README.md || grep -qi "docker compose" README.md; then
    if [ -f docker-compose.yml ]; then
      pass "README references Docker Compose and docker-compose.yml exists"
    else
      fail "README references Docker Compose but docker-compose.yml is missing"
    fi
  fi

  # No managed-service claims in alpha
  if grep -qi "managed\s*service\|managed\s*offering\|SaaS\|hosted\s*plan" README.md; then
    # Allow "no managed" phrasing
    if grep -qi "no managed" README.md; then
      pass "README correctly disclaims managed service"
    else
      fail "README claims managed service during alpha"
    fi
  else
    pass "README does not claim managed service"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Phase 6: Cross-artifact consistency
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "── Phase 6: Cross-artifact consistency ──"
echo ""

# Self-hosting guide should reference Docker Compose and Railway
if [ -f docs/self-hosting.md ] && [ -f README.md ]; then
  # Both should mention the same deployment paths
  if grep -qi "Railway" docs/self-hosting.md && grep -qi "Railway" README.md; then
    pass "README and self-hosting guide both cover Railway"
  else
    fail "Railway coverage inconsistent between README and self-hosting guide"
  fi

  if grep -qi "Docker" docs/self-hosting.md && grep -qi "Docker" README.md; then
    pass "README and self-hosting guide both cover Docker"
  else
    fail "Docker coverage inconsistent between README and self-hosting guide"
  fi
fi

# CONTRIBUTING should reference the dev setup from README
if [ -f CONTRIBUTING.md ]; then
  if grep -qi "pnpm\|bun\|development" CONTRIBUTING.md; then
    pass "CONTRIBUTING.md references development tooling"
  else
    fail "CONTRIBUTING.md is missing development tooling references"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "── Summary ──"
echo ""
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  printf '❌ M002/S03 verification: %d check(s) failed\n' "$FAIL"
  exit 1
fi

printf '✅ M002/S03 verification: all %d checks passed\n' "$PASS"
exit 0
