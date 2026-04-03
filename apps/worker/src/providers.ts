// Provider sync router.
// Dispatches sync calls to the correct provider adapter, returning
// health metric data alongside validation status.
//
// Each adapter fetches a narrow set of metrics needed for the B2B SaaS
// health template and normalizes them into the shared contract shapes.

import type {
  ConnectorProvider,
  ProviderValidationResult,
} from "@shared/connectors";
import type {
  FunnelStageRow,
  MetricValue,
  SupportingMetricsSnapshot,
} from "@shared/startup-health";
import {
  emptyFunnelStages,
  emptySupportingMetrics,
} from "@shared/startup-health";

// ---------------------------------------------------------------------------
// Sync result — extends validation with health metric data
// ---------------------------------------------------------------------------

/** Result from a provider sync call. Includes health data on success. */
export interface ProviderSyncResult extends ProviderValidationResult {
  /** Funnel stage values. Null on failure. */
  funnelStages: Partial<Record<string, number>> | null;
  /** MRR value extracted from the provider. Null on failure. */
  mrr: number | null;
  /** Supporting metrics snapshot. Null on failure. */
  supportingMetrics: Partial<SupportingMetricsSnapshot> | null;
}

/** Result from a Postgres custom metric sync. */
export interface PostgresSyncResult extends ProviderSyncResult {
  /** Custom metric data extracted from the prepared view. */
  customMetric: {
    metricValue: number;
    previousValue: number | null;
    capturedAt: string;
  } | null;
}

export type ProviderValidateFn = (
  provider: ConnectorProvider,
  configJson: string
) => Promise<ProviderValidationResult>;

export type ProviderSyncFn = (
  provider: ConnectorProvider,
  configJson: string
) => Promise<ProviderSyncResult>;

const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function invalidProviderSync(
  error: string,
  retryable?: boolean
): ProviderSyncResult {
  return {
    valid: false,
    error,
    retryable,
    mrr: null,
    supportingMetrics: null,
    funnelStages: null,
  };
}

function invalidPostgresSync(
  error: string,
  retryable?: boolean
): PostgresSyncResult {
  return {
    ...invalidProviderSync(error, retryable),
    customMetric: null,
  };
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function sumSeriesValues(values: number[] | undefined): number {
  return values?.reduce((total, value) => total + value, 0) ?? 0;
}

function getTrendTotal(
  result: {
    aggregated_value?: number;
    count?: number;
    data?: number[];
  } | null
): number {
  if (!result) {
    return 0;
  }

  return (
    result.aggregated_value ?? result.count ?? sumSeriesValues(result.data)
  );
}

async function fetchPostHogTrendTotal(
  baseUrl: string,
  projectId: string,
  apiKey: string,
  eventQuery: string
): Promise<number> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const response = await fetchWithTimeout(
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/insights/trend/?events=${eventQuery}&date_from=${thirtyDaysAgo.toISOString().split("T")[0]}&date_to=${now.toISOString().split("T")[0]}`,
    POSTHOG_TIMEOUT_MS,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    return 0;
  }

  const data = (await response.json()) as {
    result?: Array<{
      aggregated_value?: number;
      count?: number;
      data?: number[];
    }>;
  };

  return getTrendTotal(data.result?.[0] ?? null);
}

async function validatePostHogConnection(
  baseUrl: string,
  projectId: string,
  apiKey: string
): Promise<ProviderSyncResult | null> {
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/`,
      POSTHOG_TIMEOUT_MS,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      }
    );

    if (response.status === 401 || response.status === 403) {
      return invalidProviderSync(
        "PostHog API key is invalid or lacks access to the specified project."
      );
    }
    if (response.status === 404) {
      return invalidProviderSync(
        "PostHog project not found. Verify the project ID and host."
      );
    }
    if (response.status >= 500) {
      return invalidProviderSync(
        "PostHog API returned a server error. Try again shortly.",
        true
      );
    }
    if (response.status !== 200) {
      return invalidProviderSync(
        `PostHog validation failed with status ${response.status}.`
      );
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return invalidProviderSync(
        "PostHog validation timed out. Check the host URL and try again.",
        true
      );
    }

    return invalidProviderSync(
      "PostHog validation request failed. Check the host URL and network connectivity.",
      true
    );
  }

  return null;
}

async function fetchStripeBalanceValidation(
  headers: Record<string, string>
): Promise<ProviderSyncResult | null> {
  try {
    const response = await fetchWithTimeout(
      "https://api.stripe.com/v1/balance",
      STRIPE_TIMEOUT_MS,
      {
        method: "GET",
        headers,
      }
    );

    if (response.status === 401) {
      return invalidProviderSync(
        "Stripe secret key is invalid or has been revoked."
      );
    }
    if (response.status === 403) {
      return invalidProviderSync("Stripe key lacks the required permissions.");
    }
    if (response.status >= 500) {
      return invalidProviderSync(
        "Stripe API returned a server error. Try again shortly.",
        true
      );
    }
    if (response.status !== 200) {
      return invalidProviderSync(
        `Stripe validation failed with status ${response.status}.`
      );
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return invalidProviderSync(
        "Stripe validation timed out. Try again.",
        true
      );
    }

    return invalidProviderSync(
      "Stripe validation request failed. Check network connectivity.",
      true
    );
  }

  return null;
}

interface StripeRevenueMetrics {
  customerCount: number;
  mrr: number;
  totalRevenue: number;
}

async function fetchStripeRevenueMetrics(
  headers: Record<string, string>
): Promise<StripeRevenueMetrics> {
  let mrr = 0;
  let totalRevenue = 0;
  let customerCount = 0;

  try {
    const response = await fetchWithTimeout(
      "https://api.stripe.com/v1/subscriptions?status=active&limit=100",
      STRIPE_TIMEOUT_MS,
      {
        method: "GET",
        headers,
      }
    );

    if (response.ok) {
      const data = (await response.json()) as {
        data?: Array<{
          items?: {
            data?: Array<{
              price?: {
                unit_amount?: number;
                recurring?: { interval?: string };
              };
            }>;
          };
          customer?: string;
        }>;
      };

      const customers = new Set<string>();
      for (const subscription of data.data ?? []) {
        if (typeof subscription.customer === "string") {
          customers.add(subscription.customer);
        }
        for (const item of subscription.items?.data ?? []) {
          const amount = item.price?.unit_amount ?? 0;
          const interval = item.price?.recurring?.interval ?? "month";
          const monthlyAmount = interval === "year" ? amount / 12 : amount;
          mrr += monthlyAmount;
          totalRevenue += monthlyAmount;
        }
      }

      customerCount = customers.size;
    }
  } catch {
    // Non-fatal: metrics stay at 0
  }

  return {
    customerCount,
    mrr: Math.round(mrr) / 100,
    totalRevenue: Math.round(totalRevenue) / 100,
  };
}

async function fetchStripeChurnedCount(
  headers: Record<string, string>
): Promise<number> {
  try {
    const thirtyDaysAgo = Math.floor(
      (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
    );
    const response = await fetchWithTimeout(
      `https://api.stripe.com/v1/subscriptions?status=canceled&created[gte]=${thirtyDaysAgo}&limit=100`,
      STRIPE_TIMEOUT_MS,
      {
        method: "GET",
        headers,
      }
    );

    if (!response.ok) {
      return 0;
    }

    const data = (await response.json()) as { data?: unknown[] };
    return data.data?.length ?? 0;
  } catch {
    return 0;
  }
}

function buildStripeSyncResult(args: {
  churnedCount: number;
  customerCount: number;
  mrr: number;
  totalRevenue: number;
}): ProviderSyncResult {
  const totalCustomersForChurn = args.customerCount + args.churnedCount;
  const churnRate =
    totalCustomersForChurn > 0
      ? (args.churnedCount / totalCustomersForChurn) * 100
      : 0;
  const arpu =
    args.customerCount > 0 ? args.totalRevenue / args.customerCount : 0;

  return {
    valid: true,
    mrr: args.mrr,
    supportingMetrics: {
      customer_count: { value: args.customerCount, previous: null },
      churn_rate: { value: Math.round(churnRate * 100) / 100, previous: null },
      arpu: { value: Math.round(arpu * 100) / 100, previous: null },
    },
    funnelStages: {
      paying_customer: args.customerCount,
    },
  };
}

function parseNumericCell(value: unknown): number {
  if (typeof value === "string") {
    return Number.parseFloat(value);
  }
  if (typeof value === "number") {
    return value;
  }

  return Number.NaN;
}

function parseRequiredNumericCell(value: unknown, fieldName: string): number {
  const parsed = parseNumericCell(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} is not a finite number: ${String(value)}`);
  }

  return parsed;
}

function parseOptionalNumericCell(
  value: unknown,
  fieldName: string
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return parseRequiredNumericCell(value, fieldName);
}

function parseCapturedAtCell(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  throw new Error(`captured_at is missing or invalid: ${String(value)}`);
}

function parsePostgresSyncConfig(config: {
  connectionUri?: string;
  schema?: string;
  view?: string;
}):
  | { connectionUri: string; schema: string; view: string }
  | PostgresSyncResult {
  const connectionUri = config.connectionUri?.trim() ?? "";
  const schema = config.schema?.trim() ?? "";
  const view = config.view?.trim() ?? "";

  if (!connectionUri) {
    return invalidPostgresSync("Postgres connection URI is required.");
  }

  if (!(schema && view)) {
    return invalidPostgresSync("Postgres schema and view are required.");
  }

  if (!(SQL_IDENTIFIER_RE.test(schema) && SQL_IDENTIFIER_RE.test(view))) {
    return invalidPostgresSync("Schema or view identifier is not SQL-safe.");
  }

  return {
    connectionUri,
    schema,
    view,
  };
}

async function connectPostgresReadonlyClient(connectionUri: string): Promise<
  | {
      client: {
        end: () => Promise<void>;
        query: (sql: string) => Promise<{ rows: unknown[] }>;
      };
    }
  | { error: PostgresSyncResult }
> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: connectionUri,
    connectionTimeoutMillis: POSTGRES_TIMEOUT_MS,
    query_timeout: POSTGRES_TIMEOUT_MS,
    application_name: "dashboard-worker-readonly",
  });

  try {
    await client.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAuthError =
      message.includes("authentication") || message.includes("password");
    return {
      error: invalidPostgresSync(
        isAuthError
          ? `Postgres authentication failed: ${message}`
          : `Postgres connection failed: ${message}`,
        !isAuthError
      ),
    };
  }

  return { client };
}

async function queryPostgresCustomMetric(
  client: { query: (sql: string) => Promise<{ rows: unknown[] }> },
  schema: string,
  view: string
): Promise<PostgresSyncResult> {
  await client.query("SET TRANSACTION READ ONLY");

  const quotedSchema = `"${schema}"`;
  const quotedView = `"${view}"`;
  const queryText = `SELECT metric_value, previous_value, captured_at FROM ${quotedSchema}.${quotedView} LIMIT 1`;
  const result = await client.query(queryText);

  if (result.rows.length === 0) {
    return invalidPostgresSync(
      `Prepared view ${schema}.${view} returned no rows.`,
      true
    );
  }

  const row = result.rows[0] as Record<string, unknown>;

  try {
    return {
      valid: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: {
        metricValue: parseRequiredNumericCell(
          row.metric_value,
          `metric_value from ${schema}.${view}`
        ),
        previousValue: parseOptionalNumericCell(
          row.previous_value,
          `previous_value from ${schema}.${view}`
        ),
        capturedAt: parseCapturedAtCell(row.captured_at),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return invalidPostgresSync(message);
  }
}

// ---------------------------------------------------------------------------
// Metric merging helpers
// ---------------------------------------------------------------------------

/**
 * Merge partial provider metrics into a full SupportingMetricsSnapshot,
 * filling missing keys with zeros. Carries forward previous values
 * from an existing snapshot when available.
 */
export function mergeMetrics(
  stripe: Partial<SupportingMetricsSnapshot> | null,
  posthog: Partial<SupportingMetricsSnapshot> | null,
  previous: SupportingMetricsSnapshot | null
): SupportingMetricsSnapshot {
  const base = emptySupportingMetrics();
  const sources = [stripe, posthog];

  for (const src of sources) {
    if (!src) {
      continue;
    }
    for (const [key, mv] of Object.entries(src)) {
      const k = key as keyof SupportingMetricsSnapshot;
      if (k in base) {
        base[k] = mv as MetricValue;
      }
    }
  }

  // Carry forward previous values for delta computation
  if (previous) {
    for (const key of Object.keys(base) as Array<
      keyof SupportingMetricsSnapshot
    >) {
      if (base[key].previous === null && previous[key]) {
        base[key] = { ...base[key], previous: previous[key].value };
      }
    }
  }

  return base;
}

/**
 * Merge partial funnel data into a complete FunnelStageRow array.
 */
export function mergeFunnel(
  posthogFunnel: Partial<Record<string, number>> | null
): FunnelStageRow[] {
  const base = emptyFunnelStages();
  if (!posthogFunnel) {
    return base;
  }

  return base.map((row) => {
    const override = posthogFunnel[row.stage];
    if (override !== undefined && Number.isFinite(override)) {
      return { ...row, value: override };
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// PostHog adapter — fetches analytics metrics
// ---------------------------------------------------------------------------

const POSTHOG_TIMEOUT_MS = 10_000;

async function syncPostHog(config: {
  apiKey?: string;
  projectId?: string;
  host?: string;
}): Promise<ProviderSyncResult> {
  const apiKey = config.apiKey?.trim() ?? "";
  const projectId = config.projectId?.trim() ?? "";
  const host = config.host?.trim() ?? "";

  if (!apiKey) {
    return invalidProviderSync("PostHog API key is required.");
  }
  if (!projectId) {
    return invalidProviderSync("PostHog project ID is required.");
  }
  if (!/^https?:\/\/.+/.test(host)) {
    return invalidProviderSync(
      "PostHog host must be a valid URL (e.g. https://app.posthog.com)."
    );
  }

  const baseUrl = host.replace(/\/+$/, "");

  // 1. Validate connection by fetching project info
  const validationError = await validatePostHogConnection(
    baseUrl,
    projectId,
    apiKey
  );
  if (validationError) {
    return validationError;
  }

  // 2. Fetch active users (persons count or distinct IDs in last 30 days)
  let activeUsers = 0;
  try {
    activeUsers = await fetchPostHogTrendTotal(
      baseUrl,
      projectId,
      apiKey,
      '[{"id":"$pageview","type":"events","math":"dau"}]'
    );
  } catch {
    // Non-fatal: metric stays at 0
  }

  // 3. Fetch funnel data (signups from events if available)
  let visitors = 0;
  let signups = 0;
  let activations = 0;
  try {
    visitors = await fetchPostHogTrendTotal(
      baseUrl,
      projectId,
      apiKey,
      '[{"id":"$pageview","type":"events","math":"unique_session"}]'
    );
    signups = await fetchPostHogTrendTotal(
      baseUrl,
      projectId,
      apiKey,
      '[{"id":"$identify","type":"events","math":"total"}]'
    );

    // Estimate activations as a fraction of signups for now
    activations = Math.floor(signups * 0.4);
  } catch {
    // Non-fatal: funnel stays at zeros
  }

  return {
    valid: true,
    mrr: null, // MRR comes from Stripe, not PostHog
    supportingMetrics: {
      active_users: { value: activeUsers, previous: null },
    },
    funnelStages: {
      visitor: visitors,
      signup: signups,
      activation: activations,
    },
  };
}

// ---------------------------------------------------------------------------
// Stripe adapter — fetches financial metrics
// ---------------------------------------------------------------------------

const STRIPE_TIMEOUT_MS = 10_000;

async function syncStripe(config: {
  secretKey?: string;
}): Promise<ProviderSyncResult> {
  const key = config.secretKey?.trim() ?? "";
  if (!key) {
    return invalidProviderSync("Stripe secret key is required.");
  }
  if (!/^(sk_test_|sk_live_|rk_test_|rk_live_)/.test(key)) {
    return invalidProviderSync(
      "Stripe key format is invalid. Keys must start with sk_test_, sk_live_, rk_test_, or rk_live_."
    );
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };

  const validationError = await fetchStripeBalanceValidation(headers);
  if (validationError) {
    return validationError;
  }

  const revenueMetrics = await fetchStripeRevenueMetrics(headers);
  const churnedCount = await fetchStripeChurnedCount(headers);

  return buildStripeSyncResult({
    churnedCount,
    customerCount: revenueMetrics.customerCount,
    mrr: revenueMetrics.mrr,
    totalRevenue: revenueMetrics.totalRevenue,
  });
}

// ---------------------------------------------------------------------------
// Postgres adapter — fetches one custom metric from a prepared view
// ---------------------------------------------------------------------------

const POSTGRES_TIMEOUT_MS = 10_000;

/**
 * Connect read-only to an external Postgres database and query the
 * narrow prepared view contract: SELECT metric_value, previous_value,
 * captured_at FROM <schema>.<view> LIMIT 1.
 *
 * The config JSON shape mirrors the API setup contract:
 *   { connectionUri, schema, view, label, unit }
 *
 * Returns a PostgresSyncResult — valid:true with custom metric data on success,
 * valid:false with a descriptive error on failure.
 */
async function syncPostgres(config: {
  connectionUri?: string;
  schema?: string;
  view?: string;
  label?: string;
  unit?: string;
}): Promise<PostgresSyncResult> {
  const parsedConfig = parsePostgresSyncConfig(config);
  if ("valid" in parsedConfig) {
    return parsedConfig;
  }
  const { connectionUri, schema, view } = parsedConfig;

  const clientResult = await connectPostgresReadonlyClient(connectionUri);
  if ("error" in clientResult) {
    return clientResult.error;
  }
  const { client } = clientResult;

  try {
    return await queryPostgresCustomMetric(client, schema, view);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.includes("timeout") || message.includes("ETIMEDOUT");
    return invalidPostgresSync(
      `Postgres query failed on ${schema}.${view}: ${message}`,
      isTimeout
    );
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore cleanup errors */
    }
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Production provider sync router — creates real sync functions.
 * Each adapter validates credentials AND fetches narrow metric inputs.
 */
export function createProviderRouter(): ProviderValidateFn {
  return async (provider, configJson) => {
    let config: unknown;
    try {
      config = JSON.parse(configJson);
    } catch {
      return {
        valid: false,
        error: `Malformed provider config JSON for ${provider}.`,
      };
    }

    switch (provider) {
      case "posthog": {
        const ph = config as {
          apiKey?: string;
          projectId?: string;
          host?: string;
        };
        return syncPostHog(ph);
      }
      case "stripe": {
        const st = config as { secretKey?: string };
        return syncStripe(st);
      }
      case "postgres": {
        const pg = config as {
          connectionUri?: string;
          schema?: string;
          view?: string;
          label?: string;
          unit?: string;
        };
        return syncPostgres(pg);
      }
      default:
        return {
          valid: false,
          error: `Unsupported provider: ${provider as string}`,
        };
    }
  };
}

/**
 * Production provider sync router — returns ProviderSyncResult with health data.
 */
export function createProviderSyncRouter(): ProviderSyncFn {
  return async (provider, configJson) => {
    let config: unknown;
    try {
      config = JSON.parse(configJson);
    } catch {
      return {
        valid: false,
        error: `Malformed provider config JSON for ${provider}.`,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }

    switch (provider) {
      case "posthog": {
        const ph = config as {
          apiKey?: string;
          projectId?: string;
          host?: string;
        };
        return syncPostHog(ph);
      }
      case "stripe": {
        const st = config as { secretKey?: string };
        return syncStripe(st);
      }
      case "postgres": {
        const pg = config as {
          connectionUri?: string;
          schema?: string;
          view?: string;
          label?: string;
          unit?: string;
        };
        return syncPostgres(pg);
      }
      default:
        return {
          valid: false,
          error: `Unsupported provider: ${provider as string}`,
          mrr: null,
          supportingMetrics: null,
          funnelStages: null,
        };
    }
  };
}

/**
 * Stub provider router for tests — always returns the configured result.
 */
export function createStubProviderRouter(
  result: ProviderValidationResult = { valid: true }
): ProviderValidateFn & {
  calls: Array<{ provider: ConnectorProvider; configJson: string }>;
} {
  const calls: Array<{ provider: ConnectorProvider; configJson: string }> = [];
  const fn = async (provider: ConnectorProvider, configJson: string) => {
    calls.push({ provider, configJson });
    return result;
  };
  fn.calls = calls;
  return fn;
}

/**
 * Stub sync provider router for tests — returns health data.
 */
export function createStubSyncRouter(
  result: ProviderSyncResult = {
    valid: true,
    mrr: 5000,
    supportingMetrics: emptySupportingMetrics(),
    funnelStages: null,
  }
): ProviderSyncFn & {
  calls: Array<{ provider: ConnectorProvider; configJson: string }>;
} {
  const calls: Array<{ provider: ConnectorProvider; configJson: string }> = [];
  const fn = async (provider: ConnectorProvider, configJson: string) => {
    calls.push({ provider, configJson });
    return result;
  };
  fn.calls = calls;
  return fn;
}

/**
 * Failing provider router stub for error-path tests.
 */
export function createThrowingProviderRouter(
  error = "Provider connection refused"
): ProviderValidateFn {
  return async () => {
    throw new Error(error);
  };
}

// ---------------------------------------------------------------------------
// Founder-proof deterministic sync router
// ---------------------------------------------------------------------------

/** Demo credentials that the founder-proof API validators accept. */
export const FOUNDER_PROOF_POSTHOG_CONFIG = {
  apiKey: "phc_founderproof",
  projectId: "1",
  host: "https://app.posthog.com",
} as const;

export const FOUNDER_PROOF_STRIPE_CONFIG = {
  secretKey: "sk_test_founderproof",
} as const;

/**
 * Founder-proof provider sync router.
 * Returns deterministic, realistic health data without calling live APIs.
 * Preserves the same contract shapes as the real routers so the rest of
 * the pipeline (snapshot recompute, insight generation) runs unchanged.
 */
export function createFounderProofSyncRouter(): ProviderSyncFn {
  return async (provider, configJson): Promise<ProviderSyncResult> => {
    let _config: unknown;
    try {
      _config = JSON.parse(configJson);
    } catch {
      return {
        valid: false,
        error: `Malformed provider config JSON for ${provider}.`,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }

    switch (provider) {
      case "posthog": {
        return {
          valid: true,
          mrr: null,
          supportingMetrics: {
            active_users: { value: 1420, previous: 1380 },
          },
          funnelStages: {
            visitor: 8500,
            signup: 620,
            activation: 248,
          },
        };
      }
      case "stripe": {
        return {
          valid: true,
          mrr: 12_400,
          supportingMetrics: {
            customer_count: { value: 48, previous: 45 },
            churn_rate: { value: 3.2, previous: 2.8 },
            arpu: { value: 258.33, previous: 244.44 },
          },
          funnelStages: {
            paying_customer: 48,
          },
        };
      }
      default:
        return {
          valid: false,
          error: `Unsupported provider in founder-proof mode: ${provider as string}`,
          mrr: null,
          supportingMetrics: null,
          funnelStages: null,
        };
    }
  };
}
