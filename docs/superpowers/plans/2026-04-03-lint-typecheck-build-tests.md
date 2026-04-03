# Lint, Typecheck, Build, and Test Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the root workspace command surface accurate and green so `bun run lint`, `bun run typecheck`, `bun run build`, and `bun run test` all succeed on April 3, 2026.

**Architecture:** Fix the repo contract first by making root scripts match the actual quality gates. Then remove the current Ultracite blockers in focused batches: API/shared runtime code, test-only non-null assertions and empty blocks, then web/worker complexity hotspots. Stabilize API integration tests by teaching the API bootstrap to create the missing test database and by centralizing guarded test helpers so bootstrap failures do not cascade into `afterAll` crashes.

**Tech Stack:** Bun, TypeScript, Ultracite/Biome, React 19 + Vite, Elysia, Drizzle ORM, `pg`, BullMQ, Playwright, Bun test

---

## Current Baseline

Observed on `2026-04-03` from the repo root:

- `bun run typecheck`: passes.
- `bun run build`: fails immediately because the root `package.json` has no `build` script.
- `bun run --cwd apps/web build`: passes, with a chunk-size warning only.
- `bun run --cwd apps/worker build`: passes.
- `pnpm dlx ultracite check`: fails with formatting, `noNonNullAssertion`, `noEmptyBlockStatements`, `noNestedTernary`, a11y, array-key, and several `noExcessiveCognitiveComplexity` errors across `apps/api`, `apps/web`, `apps/worker`, and `packages/shared`.
- `bun run test`: fails in API integration suites because Postgres is reachable but the `porta` database does not exist, then multiple suites crash in `afterAll()` because `app` never finished bootstrapping.

## File Map

- Modify: `package.json`
- Modify: `.bg-shell/manifest.json`
- Modify: `apps/api/src/db/index.ts`
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/lib/connectors/posthog.ts`
- Modify: `apps/api/src/lib/connectors/stripe.ts`
- Modify: `apps/api/src/lib/startup-health.ts`
- Modify: `apps/api/src/routes/connector.ts`
- Modify: `packages/shared/src/startup-health.ts`
- Modify: `packages/shared/src/startup-insight.ts`
- Create: `apps/api/tests/helpers/test-app.ts`
- Modify: `apps/api/tests/auth-and-workspace.test.ts`
- Modify: `apps/api/tests/connector.foundation.test.ts`
- Modify: `apps/api/tests/connector.routes.test.ts`
- Modify: `apps/api/tests/founder-proof.connectors.test.ts`
- Modify: `apps/api/tests/internal-task.routes.test.ts`
- Modify: `apps/api/tests/postgres-custom-metric.health.test.ts`
- Modify: `apps/api/tests/postgres-custom-metric.setup.test.ts`
- Modify: `apps/api/tests/runtime-health.alpha.test.ts`
- Modify: `apps/api/tests/runtime-health.test.ts`
- Modify: `apps/api/tests/startup-health.foundation.test.ts`
- Modify: `apps/api/tests/startup-health.integration.test.ts`
- Modify: `apps/api/tests/startup-insight.foundation.test.ts`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/connector-status-panel.tsx`
- Modify: `apps/web/src/components/skeleton-screens.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx`
- Modify: `apps/web/src/routes/_authenticated/onboarding.test.tsx`
- Modify: `apps/web/src/routes/_authenticated/onboarding.tsx`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/insights.ts`
- Modify: `apps/worker/src/processors/sync.ts`
- Modify: `apps/worker/src/processors/task-sync.ts`
- Modify: `apps/worker/src/providers.ts`
- Modify: `apps/worker/tests/founder-proof.worker.test.ts`
- Modify: `apps/worker/tests/health-sync.worker.test.ts`

### Task 1: Fix The Root Command Contract

**Files:**
- Modify: `package.json`
- Modify: `.bg-shell/manifest.json`

- [ ] **Step 1: Reproduce the broken root command contract**

Run:

```bash
bun run lint
bun run build
pnpm dlx ultracite check
```

Expected:

- `bun run lint` misleadingly succeeds because it only runs `typecheck`.
- `bun run build` fails with `error: Script not found "build"`.
- `pnpm dlx ultracite check` fails with the current lint inventory.

- [ ] **Step 2: Update the root scripts so command names match reality**

Patch `package.json` so root commands are explicit and composable:

```json
{
  "scripts": {
    "test": "bun test apps/api/tests apps/web/src",
    "typecheck": "bun tsc -p apps/api/tsconfig.json --noEmit && bun tsc -p apps/web/tsconfig.json --noEmit && bun tsc -p packages/shared/tsconfig.json --noEmit && bun tsc -p apps/worker/tsconfig.json --noEmit",
    "lint": "pnpm dlx ultracite check",
    "lint:fix": "pnpm dlx ultracite fix",
    "build": "bun run --cwd apps/web build && bun run --cwd apps/worker build",
    "check": "pnpm dlx ultracite check",
    "fix": "pnpm dlx ultracite fix"
  }
}
```

Keep the existing test and typecheck commands intact. Only change the script wiring.

- [ ] **Step 3: Normalize the formatting-only file that currently blocks the formatter**

Rewrite `.bg-shell/manifest.json` to the exact content Biome expects:

```json
[]
```

- [ ] **Step 4: Verify the contract change**

Run:

```bash
bun run build
bun run lint
```

Expected:

- `bun run build` now executes both package builds and only fails on real build problems.
- `bun run lint` now runs Ultracite and fails on actual lint errors instead of silently typechecking.

- [ ] **Step 5: Commit**

```bash
git add package.json .bg-shell/manifest.json
git commit -m "chore: align root lint and build scripts with workspace checks"
```

---

### Task 2: Make API Bootstrap Create The Missing Test Database

**Files:**
- Modify: `apps/api/src/db/index.ts`
- Test: `apps/api/tests/connector.routes.test.ts`

- [ ] **Step 1: Capture the current failing integration behavior**

Run:

```bash
bun test apps/api/tests/connector.routes.test.ts
```

Expected: failure containing `Database bootstrap timed out after 5000ms while waiting for Postgres. Last error: database "porta" does not exist`.

- [ ] **Step 2: Add a test-only database bootstrap helper before the existing pool waits**

Add a helper set to `apps/api/src/db/index.ts` that extracts the database name from `env.databaseUrl`, connects to the admin `postgres` database, checks `pg_database`, and creates the target DB when it is missing in `test` mode:

```ts
function parseDatabaseUrlParts(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";

  return {
    adminConnectionString: adminUrl.toString(),
    databaseName,
  };
}

async function ensureTestDatabaseExists(env: ApiEnv) {
  if (env.nodeEnv !== "test") {
    return;
  }

  const { adminConnectionString, databaseName } = parseDatabaseUrlParts(
    env.databaseUrl
  );
  const adminPool = new Pool({
    connectionString: adminConnectionString,
    max: 1,
    connectionTimeoutMillis: env.databaseConnectTimeoutMs,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
  });

  try {
    const result = (await adminPool.query(
      `select 1 from pg_database where datname = '${databaseName}'`
    )) as { rows?: Array<Record<string, unknown>> };

    if ((result.rows ?? []).length === 0) {
      await adminPool.query(`create database "${databaseName}"`);
    }
  } finally {
    await adminPool.end();
  }
}
```

Call it at the top of `bootstrap()` before `waitForDatabase(pool, env.databaseConnectTimeoutMs)`.

- [ ] **Step 3: Keep the bootstrap failure readable**

If the admin connection itself fails, throw a clearer test-oriented message rather than masking the original infrastructure error:

```ts
try {
  await ensureTestDatabaseExists(env);
} catch (error) {
  throw new Error(
    `Test database bootstrap failed for ${env.databaseUrl}: ${error instanceof Error ? error.message : String(error)}`
  );
}
```

- [ ] **Step 4: Re-run the previously failing suite**

Run:

```bash
bun test apps/api/tests/connector.routes.test.ts
```

Expected: the suite now gets past database bootstrap and either passes or fails only on test assertions or lint issues, not `database "porta" does not exist`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/index.ts
git commit -m "fix: auto-create missing test database during api bootstrap"
```

---

### Task 3: Centralize API Test Helpers And Remove Cascading Cleanup Crashes

**Files:**
- Create: `apps/api/tests/helpers/test-app.ts`
- Modify: `apps/api/tests/auth-and-workspace.test.ts`
- Modify: `apps/api/tests/connector.foundation.test.ts`
- Modify: `apps/api/tests/connector.routes.test.ts`
- Modify: `apps/api/tests/founder-proof.connectors.test.ts`
- Modify: `apps/api/tests/internal-task.routes.test.ts`
- Modify: `apps/api/tests/postgres-custom-metric.health.test.ts`
- Modify: `apps/api/tests/postgres-custom-metric.setup.test.ts`
- Modify: `apps/api/tests/startup-health.foundation.test.ts`
- Modify: `apps/api/tests/startup-health.integration.test.ts`
- Modify: `apps/api/tests/startup-insight.foundation.test.ts`

- [ ] **Step 1: Add a small helper module for guarded test app lifecycle and required values**

Create `apps/api/tests/helpers/test-app.ts`:

```ts
import { type ApiApp, createApiApp } from "../../src/app";

export const API_TEST_ENV = {
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/porta",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  MAGIC_LINK_SENDER_EMAIL: "dev@porta.local",
  CONNECTOR_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  AUTH_CONTEXT_TIMEOUT_MS: "2000",
  DATABASE_CONNECT_TIMEOUT_MS: "5000",
  DATABASE_POOL_MAX: "5",
} as const;

export async function createTestApiApp(
  options?: Parameters<typeof createApiApp>[1]
) {
  return createApiApp(API_TEST_ENV, options);
}

export async function closeTestApiApp(app: ApiApp | undefined) {
  await app?.runtime.db.close();
}

export function requireValue<T>(
  value: T | null | undefined,
  message: string
): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}
```

- [ ] **Step 2: Replace duplicated inline env objects and unsafe teardown**

In each listed API integration test:

- replace the local `TEST_ENV` / `BASE_ENV` object with `API_TEST_ENV`
- replace `let app: ApiApp;` with `let app: ApiApp | undefined;`
- replace `afterAll(async () => { await app.runtime.db.close(); });` with:

```ts
afterAll(async () => {
  await closeTestApiApp(app);
});
```

- [ ] **Step 3: Replace test-only non-null assertions with explicit guards**

Apply this pattern anywhere a test currently does `magicLink!.url`, `rows[0]!`, or `body.health!.supportingMetrics`:

```ts
const magicLink = requireValue(
  app.runtime.auth.getLatestMagicLink(email),
  `Expected magic link for ${email}`
);
const verifyResponse = await app.handle(new Request(magicLink.url));
```

```ts
expect(rows).toHaveLength(1);
const row = requireValue(rows[0], "Expected connector row to exist.");
```

```ts
expect(body.health).not.toBeNull();
const health = requireValue(body.health, "Expected health payload.");
const metricKeys = Object.keys(health.supportingMetrics).sort();
```

- [ ] **Step 4: Run the previously failing API suites**

Run:

```bash
bun test apps/api/tests/connector.routes.test.ts
bun test apps/api/tests/founder-proof.connectors.test.ts
bun test apps/api/tests/startup-health.integration.test.ts
```

Expected: no `afterAll()` crash from `app.runtime` being undefined, and no test-only `!` usage remains in the touched files.

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests/helpers/test-app.ts apps/api/tests/auth-and-workspace.test.ts apps/api/tests/connector.foundation.test.ts apps/api/tests/connector.routes.test.ts apps/api/tests/founder-proof.connectors.test.ts apps/api/tests/internal-task.routes.test.ts apps/api/tests/postgres-custom-metric.health.test.ts apps/api/tests/postgres-custom-metric.setup.test.ts apps/api/tests/startup-health.foundation.test.ts apps/api/tests/startup-health.integration.test.ts apps/api/tests/startup-insight.foundation.test.ts
git commit -m "test: centralize api app helpers and guard integration teardown"
```

---

### Task 4: Remove API And Shared Lint Blockers In Production Code

**Files:**
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/lib/connectors/posthog.ts`
- Modify: `apps/api/src/lib/connectors/stripe.ts`
- Modify: `apps/api/src/lib/startup-health.ts`
- Modify: `apps/api/src/routes/connector.ts`
- Modify: `packages/shared/src/startup-health.ts`
- Modify: `packages/shared/src/startup-insight.ts`

- [ ] **Step 1: Reproduce the focused API/shared lint inventory**

Run:

```bash
pnpm dlx ultracite check --max-diagnostics=200 2>&1 | rg 'apps/api/src|packages/shared/src'
```

Expected: only the API/shared production blockers appear, notably non-null assertions and excessive complexity.

- [ ] **Step 2: Remove non-null assertions by making invariants explicit**

Use small helpers instead of `!` in `apps/api/src/auth.ts`, `apps/api/src/lib/startup-health.ts`, and `apps/api/src/routes/connector.ts`:

```ts
function requireString(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function toRequiredIso(value: Date | string, field: string): string {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();

  if (!iso) {
    throw new Error(`Expected ISO date for ${field}.`);
  }

  return iso;
}
```

Use them like this:

```ts
socialProviders: providers.google.configured
  ? {
      google: {
        clientId: requireString(env.googleClientId, "GOOGLE_CLIENT_ID missing while Google provider is marked configured."),
        clientSecret: requireString(env.googleClientSecret, "GOOGLE_CLIENT_SECRET missing while Google provider is marked configured."),
      },
    }
  : undefined,
```

```ts
computedAt: toRequiredIso(snapshot.computed_at, "health_snapshot.computed_at"),
```

- [ ] **Step 3: Reduce cognitive complexity by extracting pure validation and serialization helpers**

Refactor the high-complexity functions into small units with names that match the current responsibilities:

```ts
function validateConnectorEncryptionKey(key: string): void { /* current hex checks */ }
function readOptionalGoogleProvider(source: Record<string, string | undefined>) { /* trim + pair validation */ }
function buildApiUrls(source: Record<string, string | undefined>) { /* parseUrl calls */ }
function buildApiNumericSettings(source: Record<string, string | undefined>) { /* parseInteger calls */ }
```

```ts
function validatePostHogInput(config: PostHogConfig): ProviderValidationResult | null { /* required fields + host */ }
function mapPostHogStatus(status: number): ProviderValidationResult { /* 200/401/403/404/5xx mapping */ }
function mapStripeStatus(status: number): ProviderValidationResult { /* 200/401/403/5xx mapping */ }
```

```ts
function validateFunnelStageRow(row: unknown, seenStages: Set<string>): string | null { /* single-row checks */ }
function validateEvidenceItem(item: unknown, index: number): string | null { /* single-item checks */ }
```

```ts
async function createCustomMetricRow(/* existing args */) { /* postgres-only insert */ }
async function enqueueInitialSync(/* existing args */) { /* sync_job insert + queueProducer */ }
function buildProviderValidationFailure(validation: ProviderValidationResult) { /* 422 payload */ }
```

- [ ] **Step 4: Re-run focused lint and typecheck**

Run:

```bash
pnpm dlx ultracite check --max-diagnostics=200 2>&1 | rg 'apps/api/src|packages/shared/src'
bun run typecheck
```

Expected: no remaining production-code errors from those files, and typecheck stays green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth.ts apps/api/src/lib/env.ts apps/api/src/lib/connectors/posthog.ts apps/api/src/lib/connectors/stripe.ts apps/api/src/lib/startup-health.ts apps/api/src/routes/connector.ts packages/shared/src/startup-health.ts packages/shared/src/startup-insight.ts
git commit -m "fix: remove api and shared lint blockers"
```

---

### Task 5: Fix Test-Only Empty Blocks And Remaining API/Web/Worker Non-Null Assertions

**Files:**
- Modify: `apps/api/tests/runtime-health.alpha.test.ts`
- Modify: `apps/api/tests/runtime-health.test.ts`
- Modify: `apps/web/src/routes/_authenticated/onboarding.test.tsx`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/insights.ts`
- Modify: `apps/worker/tests/founder-proof.worker.test.ts`
- Modify: `apps/worker/tests/health-sync.worker.test.ts`

- [ ] **Step 1: Reproduce the focused non-null and empty-block diagnostics**

Run:

```bash
pnpm dlx ultracite check --max-diagnostics=200 2>&1 | rg 'runtime-health|onboarding.test|apps/worker'
```

Expected: empty test stubs, worker `!` assertions, and test helper `!` assertions.

- [ ] **Step 2: Replace empty block lambdas with intentional no-op bodies**

In the runtime-health test doubles, replace empty async lambdas with comment-bearing stubs:

```ts
bootstrap: async () => {
  // Intentionally empty test double.
},
close: async () => {
  // Intentionally empty test double.
},
resetAuthTables: async () => {
  // Intentionally empty test double.
},
```

- [ ] **Step 3: Remove the remaining worker and test non-null assertions**

Apply the same `requireValue()` pattern or direct guards in worker code and test assertions:

```ts
const createLinearIssue = env.founderProofMode
  ? createFounderProofLinearClient()
  : createLinearIssueClient(
      requireValue(env.linearApiKey, "LINEAR_API_KEY is required when founder-proof mode is disabled.")
    );

const taskSyncTeamId = env.founderProofMode
  ? "founder-proof-team"
  : requireValue(env.linearTeamId, "LINEAR_TEAM_ID is required when founder-proof mode is disabled.");
```

```ts
const action = requireValue(body.tasks[0], "Expected the first task to exist.");
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
bun test apps/api/tests/runtime-health.alpha.test.ts
bun test apps/api/tests/runtime-health.test.ts
bun test apps/worker/tests/founder-proof.worker.test.ts
bun test apps/worker/tests/health-sync.worker.test.ts
```

Expected: touched tests pass and the empty-block diagnostics are gone.

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests/runtime-health.alpha.test.ts apps/api/tests/runtime-health.test.ts apps/web/src/routes/_authenticated/onboarding.test.tsx apps/worker/src/index.ts apps/worker/src/insights.ts apps/worker/tests/founder-proof.worker.test.ts apps/worker/tests/health-sync.worker.test.ts
git commit -m "fix: remove remaining worker and test assertion blockers"
```

---

### Task 6: Refactor Web And Worker Complexity Hotspots Without Changing Behavior

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/connector-status-panel.tsx`
- Modify: `apps/web/src/components/skeleton-screens.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx`
- Modify: `apps/web/src/routes/_authenticated/onboarding.tsx`
- Modify: `apps/worker/src/insights.ts`
- Modify: `apps/worker/src/processors/sync.ts`
- Modify: `apps/worker/src/processors/task-sync.ts`
- Modify: `apps/worker/src/providers.ts`

- [ ] **Step 1: Capture the UI/worker-specific lint inventory**

Run:

```bash
pnpm dlx ultracite check --max-diagnostics=200 2>&1 | rg 'apps/web/src|apps/worker/src'
```

Expected: a11y in `app-shell`, nested ternaries, array-index keys, and complexity diagnostics in dashboard/onboarding/worker files.

- [ ] **Step 2: Refactor UI hotspots into pure render and parse helpers**

Apply these patterns:

```tsx
function renderDisconnectControls(args: {
  connectorId: string;
  actionState: "idle" | "working" | "error";
  confirmingDisconnect: string | null;
  onConfirm: (id: string) => Promise<void>;
  onCancel: () => void;
  onStart: (id: string) => void;
}) {
  if (args.confirmingDisconnect !== args.connectorId) {
    return (
      <Button
        disabled={args.actionState === "working"}
        onClick={() => args.onStart(args.connectorId)}
        size="sm"
        variant="destructive"
      >
        Disconnect
      </Button>
    );
  }

  return (
    <>
      <span className="text-danger text-sm">Disconnect?</span>
      <Button
        disabled={args.actionState === "working"}
        onClick={() => void args.onConfirm(args.connectorId)}
        size="sm"
        variant="destructive"
      >
        Confirm
      </Button>
      <Button onClick={args.onCancel} size="sm" variant="outline">
        Cancel
      </Button>
    </>
  );
}
```

```ts
function parseHealthPayload(payload: unknown, startupId: string): StartupHealthPayload { /* move current dashboard parsing here */ }
function parseInsightPayload(payload: unknown, startupId: string): StartupInsightPayload { /* move current dashboard parsing here */ }
function parseTaskListPayload(payload: unknown, startupId: string) { /* move current listTasks validation here */ }
```

Also:

- replace index keys in `skeleton-screens.tsx` with deterministic string keys such as `` `startup-skeleton-${section}` ``
- replace nested ternaries in `__root.tsx` and `connector-status-panel.tsx` with early-return helpers
- fix `app-shell.tsx` so ARIA props match the actual role that element uses

- [ ] **Step 3: Refactor worker hotspots into explicit branches and helpers**

Apply these patterns:

```ts
function createTaskSyncDependencies(env: WorkerEnv) {
  if (env.founderProofMode) {
    return {
      createLinearIssue: createFounderProofLinearClient(),
      linearTeamId: "founder-proof-team",
    };
  }

  return {
    createLinearIssue: createLinearIssueClient(
      requireValue(env.linearApiKey, "LINEAR_API_KEY is required.")
    ),
    linearTeamId: requireValue(env.linearTeamId, "LINEAR_TEAM_ID is required."),
  };
}
```

```ts
async function handleSyncFailure(args: {
  repo: SyncRepository;
  syncJobId: string;
  connectorId: string;
  error: string;
  startedAt: Date;
}) {
  const completedAt = new Date();
  await args.repo.markSyncJobFailed(
    args.syncJobId,
    args.connectorId,
    args.error,
    completedAt,
    completedAt.getTime() - args.startedAt.getTime()
  );
}
```

```ts
function parseAnthropicTextBlock(body: { content?: Array<{ type: string; text?: string }> }) {
  const textBlock = body.content?.find((block) => block.type === "text");
  return requireValue(textBlock?.text, "Anthropic response contained no text block.");
}
```

Break `providers.ts` into provider-specific extraction helpers instead of one large switch-heavy function.

- [ ] **Step 4: Verify web and worker behavior after refactors**

Run:

```bash
bun test apps/web/src/routes/_authenticated/onboarding.test.tsx
bun run --cwd apps/web build
bun run --cwd apps/worker build
pnpm dlx ultracite check --max-diagnostics=200 2>&1 | rg 'apps/web/src|apps/worker/src'
```

Expected: touched web tests and both builds pass, and no remaining UI/worker lint errors appear in those paths.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/connector-status-panel.tsx apps/web/src/components/skeleton-screens.tsx apps/web/src/routes/__root.tsx apps/web/src/routes/_authenticated/dashboard.tsx apps/web/src/routes/_authenticated/onboarding.tsx apps/worker/src/insights.ts apps/worker/src/processors/sync.ts apps/worker/src/processors/task-sync.ts apps/worker/src/providers.ts
git commit -m "refactor: reduce web and worker lint complexity hotspots"
```

---

### Task 7: Final Repository Verification

**Files:**
- No new code; verification only

- [ ] **Step 1: Run formatter and full lint**

Run:

```bash
pnpm dlx ultracite fix
pnpm dlx ultracite check
```

Expected: the fix step applies only formatting-safe changes, and the check step exits clean.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: clean pass across `apps/api`, `apps/web`, `packages/shared`, and `apps/worker`.

- [ ] **Step 3: Run root build**

Run:

```bash
bun run build
```

Expected: `apps/web` and `apps/worker` both build successfully; only the existing Vite chunk-size warning is acceptable if it remains non-fatal.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
bun run test
```

Expected: API and web tests pass without database bootstrap timeouts or teardown crashes.

- [ ] **Step 5: Inspect the final delta and commit**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the planned files are changed.

Then commit:

```bash
git add -A
git commit -m "fix: restore green lint build and test workflows"
```
