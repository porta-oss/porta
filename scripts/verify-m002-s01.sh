#!/usr/bin/env bash
# verify-m002-s01.sh — M002/S01 slice verification: license, brand, and identity
# Exit on first failure so CI reports the exact failing check.
set -euo pipefail

FAIL=0
PASS=0

pass() { ((PASS++)); printf '  ✅ %s\n' "$1"; }
fail() { ((FAIL++)); printf '  ❌ %s\n' "$1"; }

echo "── M002/S01: License, brand, and identity checks ──"

# ── Legal artifacts ──────────────────────────────────────
echo ""
echo "Legal artifacts:"

if [ -f LICENSE ]; then
  if grep -q "GNU AFFERO GENERAL PUBLIC LICENSE" LICENSE; then
    pass "LICENSE contains AGPLv3 text"
  else
    fail "LICENSE exists but does not contain AGPLv3 text"
  fi
else
  fail "LICENSE file is missing"
fi

if [ -f TRADEMARK.md ]; then
  if grep -q "Porta" TRADEMARK.md; then
    pass "TRADEMARK.md mentions Porta brand"
  else
    fail "TRADEMARK.md exists but does not reference Porta"
  fi
else
  fail "TRADEMARK.md file is missing"
fi

# ── Root package identity ────────────────────────────────
echo ""
echo "Root package identity:"

ROOT_NAME=$(node -e "console.log(require('./package.json').name)" 2>/dev/null || echo "")
if [ "$ROOT_NAME" = "porta" ]; then
  pass "Root package.json name is 'porta'"
else
  fail "Root package.json name is '$ROOT_NAME' (expected 'porta')"
fi

# ── Workspace package namespaces (T02) ───────────────────
echo ""
echo "Workspace package namespaces:"

MANIFESTS=(
  "apps/api/package.json:@porta/api"
  "apps/web/package.json:@porta/web"
  "apps/worker/package.json:@porta/worker"
  "packages/shared/package.json:@porta/shared"
)

for entry in "${MANIFESTS[@]}"; do
  FILE="${entry%%:*}"
  EXPECTED="${entry##*:}"
  if [ -f "$FILE" ]; then
    ACTUAL=$(node -e "console.log(require('./$FILE').name)" 2>/dev/null || echo "")
    if [ "$ACTUAL" = "$EXPECTED" ]; then
      pass "$FILE name is '$EXPECTED'"
    else
      fail "$FILE name is '$ACTUAL' (expected '$EXPECTED')"
    fi
  else
    fail "$FILE is missing"
  fi
done

# Check workspace dependency reference in web
WEB_SHARED_DEP=$(node -e "const p=require('./apps/web/package.json');console.log(p.dependencies?.['@porta/shared']||'MISSING')" 2>/dev/null || echo "ERROR")
if [ "$WEB_SHARED_DEP" = "workspace:*" ]; then
  pass "apps/web depends on @porta/shared workspace:*"
else
  fail "apps/web @porta/shared dependency is '$WEB_SHARED_DEP' (expected 'workspace:*')"
fi

# ── Runtime defaults (T02) ───────────────────────────────
echo ""
echo "Runtime defaults (no stale brand in config files):"

CONFIG_FILES=(
  "docker-compose.yml"
  ".env.example"
  "apps/api/src/lib/env.ts"
  "apps/worker/src/env.ts"
  "apps/api/drizzle.config.ts"
  "playwright.config.ts"
)

LEGACY_VENDOR_LOWER="founder"
LEGACY_VENDOR_TITLE="Founder"
LEGACY_SUFFIX_HYPHEN="control-plane"
LEGACY_SUFFIX_SNAKE="control_plane"
LEGACY_SUFFIX_TITLE="Control Plane"

STALE_CONFIG_PATTERNS=(
  "${LEGACY_VENDOR_LOWER}-${LEGACY_SUFFIX_HYPHEN}"
  "${LEGACY_VENDOR_LOWER}_${LEGACY_SUFFIX_SNAKE}"
)

for file in "${CONFIG_FILES[@]}"; do
  if [ -f "$file" ]; then
    FOUND=""
    for pat in "${STALE_CONFIG_PATTERNS[@]}"; do
      if grep -q "$pat" "$file" 2>/dev/null; then
        FOUND="$pat"
        break
      fi
    done
    if [ -z "$FOUND" ]; then
      pass "$file has no stale brand identifiers"
    else
      fail "$file contains stale '$FOUND'"
    fi
  else
    fail "$file is missing"
  fi
done

# ── Stale brand identifiers (will grow in T02+) ─────────
echo ""
echo "Stale brand identifiers:"

# Check for old brand strings that should have been replaced.
# Exclude node_modules, .git, .gsd, and binary files.
# Keep the legacy identifiers constructed from parts so raw audit greps
# do not match this verifier's own pattern definitions.
STALE_PATTERNS=(
  "${LEGACY_VENDOR_LOWER}-${LEGACY_SUFFIX_HYPHEN}"
  "@${LEGACY_VENDOR_LOWER}-${LEGACY_SUFFIX_HYPHEN}"
  "${LEGACY_VENDOR_LOWER}_${LEGACY_SUFFIX_SNAKE}"
  "${LEGACY_VENDOR_TITLE} ${LEGACY_SUFFIX_TITLE}"
)

SELF="verify-m002-s01.sh"
for pattern in "${STALE_PATTERNS[@]}"; do
  HITS=$(grep -r --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' \
    --include='*.yaml' --include='*.yml' --include='*.sh' --include='*.env.example' \
    --include='*.html' \
    -l "$pattern" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.gsd \
    . 2>/dev/null | grep -v "$SELF" || true)
  if [ -n "$HITS" ]; then
    fail "Stale identifier '$pattern' found in:"
    echo "$HITS" | sed 's/^/        /'
  else
    pass "No stale '$pattern' references"
  fi
done

# ── Summary ──────────────────────────────────────────────
echo ""
echo "── Results: $PASS passed, $FAIL failed ──"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
