/**
 * Startup insight route tests.
 * Covers: auth rejection, scope denial, ready/unavailable/blocked/error payloads,
 * malformed inputs, workspace mismatch, and preserve-last-good semantics.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { convertSetCookieToCookie } from 'better-auth/test';
import { sql } from 'drizzle-orm';

import type { StartupDraft } from '@shared/types';
import type { InsightGenerationStatus, InsightConditionCode } from '@shared/startup-insight';

import { createApiApp, type ApiApp } from '../src/app';
import { createStubPostHogValidator } from '../src/lib/connectors/posthog';
import { createStubStripeValidator } from '../src/lib/connectors/stripe';
import { createStubQueueProducer } from '../src/lib/connectors/queue';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TEST_ENV = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  API_URL: 'http://localhost:3000',
  WEB_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane',
  REDIS_URL: 'redis://127.0.0.1:6379',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  MAGIC_LINK_SENDER_EMAIL: 'dev@founder-control-plane.local',
  CONNECTOR_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  AUTH_CONTEXT_TIMEOUT_MS: '2000',
  DATABASE_CONNECT_TIMEOUT_MS: '5000',
  DATABASE_POOL_MAX: '5',
} as const;

const VALID_STARTUP: StartupDraft = {
  name: 'Insight Route Test',
  type: 'b2b_saas',
  stage: 'mvp',
  timezone: 'UTC',
  currency: 'USD',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(app: ApiApp, url: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(url, init));
}

async function signUp(app: ApiApp, email: string): Promise<string> {
  const signInRes = await makeRequest(app, 'http://localhost:3000/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name: 'Insight Route Tester' }),
  });
  if (!signInRes.ok) throw new Error(`Magic link request failed: ${signInRes.status}`);

  const magicLink = app.runtime.auth.getLatestMagicLink(email);
  if (!magicLink) throw new Error(`No magic link for ${email}`);

  const verifyRes = await app.handle(new Request(magicLink.url));
  const cookie = convertSetCookieToCookie(verifyRes.headers).get('cookie') ?? '';
  if (!cookie) throw new Error(`No cookie returned for ${email}`);

  return cookie;
}

async function createWorkspace(app: ApiApp, cookie: string, name: string): Promise<string> {
  const response = await makeRequest(app, 'http://localhost:3000/api/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  const payload = (await response.json()) as { workspace: { id: string } };
  return payload.workspace.id;
}

async function createStartup(app: ApiApp, cookie: string, draft: StartupDraft): Promise<string> {
  const response = await makeRequest(app, 'http://localhost:3000/api/startups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(draft),
  });
  const payload = (await response.json()) as { startup: { id: string } };
  return payload.startup.id;
}

function createEvidencePayload(conditionCode: InsightConditionCode = 'mrr_declining') {
  return {
    conditionCode,
    items: [
      {
        metricKey: 'mrr',
        label: 'Monthly Recurring Revenue',
        currentValue: 9500,
        previousValue: 11000,
        direction: 'down' as const,
      },
    ],
    snapshotComputedAt: new Date().toISOString(),
    syncJobId: `job-${randomUUID()}`,
  };
}

function createExplanationPayload() {
  return {
    observation: 'MRR declined from $11,000 to $9,500 over the last 30 days.',
    hypothesis: 'Increased churn among mid-tier accounts suggests pricing friction.',
    actions: [
      { label: 'Review churn cohorts', rationale: 'Identify which customer segment is leaving.' },
      { label: 'Run pricing experiment', rationale: 'Test alternative pricing tiers.' },
    ],
    model: 'claude-sonnet-4-20250514',
    latencyMs: 1200,
  };
}

async function insertInsight(
  db: ApiApp['runtime']['db']['db'],
  startupId: string,
  overrides: {
    conditionCode?: InsightConditionCode;
    generationStatus?: InsightGenerationStatus;
    explanation?: object | null;
    lastError?: string | null;
  } = {},
): Promise<string> {
  const insightId = `insight-${randomUUID()}`;
  const conditionCode = overrides.conditionCode ?? 'mrr_declining';
  const evidence = createEvidencePayload(conditionCode);
  const explanation = overrides.explanation === undefined ? createExplanationPayload() : overrides.explanation;
  const generationStatus = overrides.generationStatus ?? 'success';
  const lastError = overrides.lastError ?? null;

  await db.execute(
    sql`INSERT INTO startup_insight (id, startup_id, condition_code, evidence, explanation, generation_status, last_error, model, explainer_latency_ms, generated_at, created_at, updated_at)
        VALUES (${insightId}, ${startupId}, ${conditionCode}, ${JSON.stringify(evidence)}::jsonb, ${explanation ? JSON.stringify(explanation) : null}::jsonb, ${generationStatus}, ${lastError}, ${'claude-sonnet-4-20250514'}, ${1200}, NOW(), NOW(), NOW())
        ON CONFLICT (startup_id) DO UPDATE SET
          condition_code = EXCLUDED.condition_code,
          evidence = EXCLUDED.evidence,
          explanation = EXCLUDED.explanation,
          generation_status = EXCLUDED.generation_status,
          last_error = EXCLUDED.last_error,
          generated_at = NOW(),
          updated_at = NOW()`,
  );

  return insightId;
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let app: ApiApp;
let cookie: string;
let startupId: string;

beforeAll(async () => {
  app = await createApiApp(TEST_ENV, {
    posthogValidator: createStubPostHogValidator(),
    stripeValidator: createStubStripeValidator(),
    queueProducer: createStubQueueProducer(),
  });

  const runId = Date.now();
  cookie = await signUp(app, `insight-rt-${runId}@example.com`);
  await createWorkspace(app, cookie, `Insight RT WS ${runId}`);
  startupId = await createStartup(app, cookie, VALID_STARTUP);
});

afterAll(async () => {
  if (app) {
    await app.runtime.db.close();
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/startups/:startupId/insight', () => {
  // ── Auth rejection ──
  test('rejects unauthenticated requests with 401', async () => {
    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  // ── Unavailable: no insight yet ──
  test('returns unavailable when no insight has been generated', async () => {
    // Create a fresh startup with no insight row
    const freshId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `Fresh ${Date.now()}`,
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${freshId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { displayStatus: string; insight: unknown; diagnosticMessage: string };
    expect(body.displayStatus).toBe('unavailable');
    expect(body.insight).toBeNull();
    expect(body.diagnosticMessage).toContain('No insight');
  });

  // ── Ready: full insight payload ──
  test('returns ready payload with observation, hypothesis, and actions', async () => {
    await insertInsight(app.runtime.db.db, startupId, {
      conditionCode: 'mrr_declining',
      generationStatus: 'success',
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      displayStatus: string;
      insight: {
        conditionCode: string;
        evidence: { items: unknown[] };
        explanation: {
          observation: string;
          hypothesis: string;
          actions: { label: string; rationale: string }[];
        };
        generationStatus: string;
      };
    };

    expect(body.displayStatus).toBe('ready');
    expect(body.insight.conditionCode).toBe('mrr_declining');
    expect(body.insight.explanation.observation).toContain('MRR');
    expect(body.insight.explanation.hypothesis).toBeTruthy();
    expect(body.insight.explanation.actions.length).toBeGreaterThanOrEqual(1);
    expect(body.insight.explanation.actions.length).toBeLessThanOrEqual(3);
    expect(body.insight.evidence.items.length).toBeGreaterThan(0);
    expect(body.insight.generationStatus).toBe('success');
  });

  // ── Blocked: generation skipped due to stale data ──
  test('returns blocked when generation was skipped due to stale data', async () => {
    await insertInsight(app.runtime.db.db, startupId, {
      conditionCode: 'no_condition_detected',
      generationStatus: 'skipped_stale',
      explanation: null,
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { displayStatus: string; diagnosticMessage: string };
    expect(body.displayStatus).toBe('blocked');
    expect(body.diagnosticMessage).toContain('stale');
  });

  // ── Error: explainer failed, no last-good insight ──
  test('returns error when explainer failed and no previous explanation exists', async () => {
    await insertInsight(app.runtime.db.db, startupId, {
      conditionCode: 'churn_spike',
      generationStatus: 'failed_explainer',
      explanation: null,
      lastError: 'Anthropic API rate limited',
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { displayStatus: string; diagnosticMessage: string };
    expect(body.displayStatus).toBe('error');
    expect(body.diagnosticMessage).toContain('Anthropic API rate limited');
  });

  // ── Preserve-last-good: failed explainer but previous explanation preserved ──
  test('returns ready with diagnostic when failed but last-good explanation exists', async () => {
    // Insert a successful insight first, then update to failed
    await insertInsight(app.runtime.db.db, startupId, {
      conditionCode: 'mrr_declining',
      generationStatus: 'failed_explainer',
      explanation: createExplanationPayload(), // last-good preserved
      lastError: 'Transient API error',
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      displayStatus: string;
      diagnosticMessage: string;
      insight: { explanation: { observation: string } };
    };
    expect(body.displayStatus).toBe('ready');
    expect(body.diagnosticMessage).toContain('failed');
    expect(body.insight.explanation.observation).toBeTruthy();
  });

  // ── Startup not found ──
  test('returns 404 for non-existent startup', async () => {
    const res = await makeRequest(app, `http://localhost:3000/api/startups/nonexistent-id/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('STARTUP_NOT_FOUND');
  });

  // ── Workspace mismatch ──
  test('returns 403 when startup belongs to a different workspace', async () => {
    // Create a second user/workspace
    const runId2 = Date.now();
    const cookie2 = await signUp(app, `other-user-${runId2}@example.com`);
    await createWorkspace(app, cookie2, `Other WS ${runId2}`);

    // Try to access the original startup from the second user
    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie: cookie2 },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('STARTUP_SCOPE_INVALID');
  });

  // ── No condition detected with explanation → ready ──
  test('returns ready when no_condition_detected but explanation exists from previous run', async () => {
    await insertInsight(app.runtime.db.db, startupId, {
      conditionCode: 'no_condition_detected',
      generationStatus: 'skipped_no_condition',
      explanation: createExplanationPayload(), // from prior success
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { displayStatus: string };
    expect(body.displayStatus).toBe('ready');
  });

  // ── No condition detected without explanation → unavailable ──
  test('returns unavailable when no_condition_detected and no explanation', async () => {
    await insertInsight(app.runtime.db.db, startupId, {
      conditionCode: 'no_condition_detected',
      generationStatus: 'skipped_no_condition',
      explanation: null,
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { displayStatus: string };
    expect(body.displayStatus).toBe('unavailable');
  });

  // ── Blocked generation status ──
  test('returns blocked when generation was skipped due to blocked connectors', async () => {
    await insertInsight(app.runtime.db.db, startupId, {
      conditionCode: 'no_condition_detected',
      generationStatus: 'skipped_blocked',
      explanation: null,
    });

    const res = await makeRequest(app, `http://localhost:3000/api/startups/${startupId}/insight`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { displayStatus: string; diagnosticMessage: string };
    expect(body.displayStatus).toBe('blocked');
    expect(body.diagnosticMessage).toContain('blocked');
  });
});
