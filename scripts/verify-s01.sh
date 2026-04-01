#!/usr/bin/env bash
set -euo pipefail

printf '\n[verify:s01] Running scaffolded S01 unit checks...\n'
bun test \
  apps/api/tests/auth-and-workspace.test.ts \
  apps/api/tests/startup.routes.test.ts \
  apps/web/src/routes/auth/sign-in.test.tsx \
  apps/web/src/routes/_authenticated.test.tsx \
  apps/web/src/routes/_authenticated/onboarding.test.tsx

printf '\n[verify:s01] Listing Playwright onboarding spec...\n'
bunx playwright test apps/web/e2e/onboarding.spec.ts --list

printf '\n[verify:s01] Scaffold verification complete.\n'
