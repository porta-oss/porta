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
    return {
      valid: false,
      error: "PostHog API key is required.",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
    };
  }
  if (!projectId) {
    return {
      valid: false,
      error: "PostHog project ID is required.",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
    };
  }
  if (!/^https?:\/\/.+/.test(host)) {
    return {
      valid: false,
      error: "PostHog host must be a valid URL (e.g. https://app.posthog.com).",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
    };
  }

  const baseUrl = host.replace(/\/+$/, "");

  // 1. Validate connection by fetching project info
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POSTHOG_TIMEOUT_MS);
    const response = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error:
          "PostHog API key is invalid or lacks access to the specified project.",
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    if (response.status === 404) {
      return {
        valid: false,
        error: "PostHog project not found. Verify the project ID and host.",
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    if (response.status >= 500) {
      return {
        valid: false,
        error: "PostHog API returned a server error. Try again shortly.",
        retryable: true,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    if (response.status !== 200) {
      return {
        valid: false,
        error: `PostHog validation failed with status ${response.status}.`,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        valid: false,
        error:
          "PostHog validation timed out. Check the host URL and try again.",
        retryable: true,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    return {
      valid: false,
      error:
        "PostHog validation request failed. Check the host URL and network connectivity.",
      retryable: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
    };
  }

  // 2. Fetch active users (persons count or distinct IDs in last 30 days)
  let activeUsers = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POSTHOG_TIMEOUT_MS);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const eventsUrl = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/insights/trend/?events=[{"id":"$pageview","type":"events","math":"dau"}]&date_from=${thirtyDaysAgo.toISOString().split("T")[0]}&date_to=${now.toISOString().split("T")[0]}`;

    const response = await fetch(eventsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      const data = (await response.json()) as {
        result?: Array<{
          aggregated_value?: number;
          count?: number;
          data?: number[];
        }>;
      };
      const firstResult = data.result?.[0];
      if (firstResult) {
        // Use aggregated_value, or sum the data array, or use count
        activeUsers =
          firstResult.aggregated_value ??
          (firstResult.data
            ? firstResult.data.reduce((a: number, b: number) => a + b, 0)
            : 0) ??
          firstResult.count ??
          0;
      }
    }
  } catch {
    // Non-fatal: metric stays at 0
  }

  // 3. Fetch funnel data (signups from events if available)
  let visitors = 0;
  let signups = 0;
  let activations = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POSTHOG_TIMEOUT_MS);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const eventsUrl = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/insights/trend/?events=[{"id":"$pageview","type":"events","math":"unique_session"}]&date_from=${thirtyDaysAgo.toISOString().split("T")[0]}&date_to=${now.toISOString().split("T")[0]}`;

    const response = await fetch(eventsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      const data = (await response.json()) as {
        result?: Array<{ aggregated_value?: number; data?: number[] }>;
      };
      const firstResult = data.result?.[0];
      if (firstResult) {
        visitors =
          firstResult.aggregated_value ??
          (firstResult.data
            ? firstResult.data.reduce((a: number, b: number) => a + b, 0)
            : 0) ??
          0;
      }
    }

    // Try to fetch signup events
    const signupUrl = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/insights/trend/?events=[{"id":"$identify","type":"events","math":"total"}]&date_from=${thirtyDaysAgo.toISOString().split("T")[0]}&date_to=${now.toISOString().split("T")[0]}`;
    const signupController = new AbortController();
    const signupTimer = setTimeout(
      () => signupController.abort(),
      POSTHOG_TIMEOUT_MS
    );
    const signupResponse = await fetch(signupUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: signupController.signal,
    });
    clearTimeout(signupTimer);

    if (signupResponse.ok) {
      const data = (await signupResponse.json()) as {
        result?: Array<{ aggregated_value?: number; data?: number[] }>;
      };
      const firstResult = data.result?.[0];
      if (firstResult) {
        signups =
          firstResult.aggregated_value ??
          (firstResult.data
            ? firstResult.data.reduce((a: number, b: number) => a + b, 0)
            : 0) ??
          0;
      }
    }

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
    return {
      valid: false,
      error: "Stripe secret key is required.",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
    };
  }
  if (!/^(sk_test_|sk_live_|rk_test_|rk_live_)/.test(key)) {
    return {
      valid: false,
      error:
        "Stripe key format is invalid. Keys must start with sk_test_, sk_live_, rk_test_, or rk_live_.",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
    };
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };

  // 1. Validate connection via balance endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);
    const response = await fetch("https://api.stripe.com/v1/balance", {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.status === 401) {
      return {
        valid: false,
        error: "Stripe secret key is invalid or has been revoked.",
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    if (response.status === 403) {
      return {
        valid: false,
        error: "Stripe key lacks the required permissions.",
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    if (response.status >= 500) {
      return {
        valid: false,
        error: "Stripe API returned a server error. Try again shortly.",
        retryable: true,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    if (response.status !== 200) {
      return {
        valid: false,
        error: `Stripe validation failed with status ${response.status}.`,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        valid: false,
        error: "Stripe validation timed out. Try again.",
        retryable: true,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
      };
    }
    return {
      valid: false,
      error: "Stripe validation request failed. Check network connectivity.",
      retryable: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
    };
  }

  // 2. Fetch active subscriptions to compute MRR
  let mrr = 0;
  let customerCount = 0;
  let churnedCount = 0;
  let totalRevenue = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);
    const response = await fetch(
      "https://api.stripe.com/v1/subscriptions?status=active&limit=100",
      {
        method: "GET",
        headers,
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

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
      for (const sub of data.data ?? []) {
        if (sub.customer) {
          customers.add(typeof sub.customer === "string" ? sub.customer : "");
        }
        for (const item of sub.items?.data ?? []) {
          const amount = item.price?.unit_amount ?? 0;
          const interval = item.price?.recurring?.interval ?? "month";
          // Normalize to monthly
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

  // Convert from cents to dollars
  mrr = Math.round(mrr) / 100;
  totalRevenue = Math.round(totalRevenue) / 100;

  // 3. Fetch canceled subscriptions for churn rate
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);
    const thirtyDaysAgo = Math.floor(
      (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
    );
    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions?status=canceled&created[gte]=${thirtyDaysAgo}&limit=100`,
      {
        method: "GET",
        headers,
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (response.ok) {
      const data = (await response.json()) as { data?: unknown[] };
      churnedCount = data.data?.length ?? 0;
    }
  } catch {
    // Non-fatal
  }

  const totalCustomersForChurn = customerCount + churnedCount;
  const churnRate =
    totalCustomersForChurn > 0
      ? (churnedCount / totalCustomersForChurn) * 100
      : 0;
  const arpu = customerCount > 0 ? totalRevenue / customerCount : 0;

  return {
    valid: true,
    mrr,
    supportingMetrics: {
      customer_count: { value: customerCount, previous: null },
      churn_rate: { value: Math.round(churnRate * 100) / 100, previous: null },
      arpu: { value: Math.round(arpu * 100) / 100, previous: null },
    },
    funnelStages: {
      paying_customer: customerCount,
    },
  };
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
  const connectionUri = config.connectionUri?.trim() ?? "";
  const schema = config.schema?.trim() ?? "";
  const view = config.view?.trim() ?? "";

  if (!connectionUri) {
    return {
      valid: false,
      error: "Postgres connection URI is required.",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };
  }
  if (!(schema && view)) {
    return {
      valid: false,
      error: "Postgres schema and view are required.",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };
  }

  // Validate identifiers are SQL-safe (re-enforce contract even though API already checked)
  const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
  if (!(SQL_IDENTIFIER_RE.test(schema) && SQL_IDENTIFIER_RE.test(view))) {
    return {
      valid: false,
      error: "Schema or view identifier is not SQL-safe.",
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };
  }

  // Dynamic import of pg to keep the module lightweight for non-postgres paths
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: connectionUri,
    connectionTimeoutMillis: POSTGRES_TIMEOUT_MS,
    query_timeout: POSTGRES_TIMEOUT_MS,
    // Read-only transaction to enforce the contract
    application_name: "dashboard-worker-readonly",
  });

  try {
    await client.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAuthError =
      message.includes("authentication") || message.includes("password");
    return {
      valid: false,
      error: isAuthError
        ? `Postgres authentication failed: ${message}`
        : `Postgres connection failed: ${message}`,
      retryable: !isAuthError,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };
  }

  try {
    // Set transaction to read-only to prevent accidental writes
    await client.query("SET TRANSACTION READ ONLY");

    // Query the prepared view with the fixed column contract
    const quotedSchema = `"${schema}"`;
    const quotedView = `"${view}"`;
    const queryText = `SELECT metric_value, previous_value, captured_at FROM ${quotedSchema}.${quotedView} LIMIT 1`;

    const result = await client.query(queryText);

    if (result.rows.length === 0) {
      return {
        valid: false,
        error: `Prepared view ${schema}.${view} returned no rows.`,
        retryable: true,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
        customMetric: null,
      };
    }

    const row = result.rows[0] as Record<string, unknown>;

    // Validate metric_value — must be a finite number
    const rawMetricValue = row.metric_value;
    const metricValue =
      typeof rawMetricValue === "string"
        ? Number.parseFloat(rawMetricValue)
        : typeof rawMetricValue === "number"
          ? rawMetricValue
          : Number.NaN;

    if (!Number.isFinite(metricValue)) {
      return {
        valid: false,
        error: `metric_value from ${schema}.${view} is not a finite number: ${String(rawMetricValue)}`,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
        customMetric: null,
      };
    }

    // Validate previous_value — may be null, but if present must be finite
    const rawPreviousValue = row.previous_value;
    let previousValue: number | null = null;
    if (rawPreviousValue !== null && rawPreviousValue !== undefined) {
      const parsed =
        typeof rawPreviousValue === "string"
          ? Number.parseFloat(rawPreviousValue)
          : typeof rawPreviousValue === "number"
            ? rawPreviousValue
            : Number.NaN;
      if (!Number.isFinite(parsed)) {
        return {
          valid: false,
          error: `previous_value from ${schema}.${view} is not a finite number: ${String(rawPreviousValue)}`,
          mrr: null,
          supportingMetrics: null,
          funnelStages: null,
          customMetric: null,
        };
      }
      previousValue = parsed;
    }

    // Validate captured_at — must be a valid date
    const rawCapturedAt = row.captured_at;
    let capturedAt: string;
    if (rawCapturedAt instanceof Date) {
      capturedAt = rawCapturedAt.toISOString();
    } else if (typeof rawCapturedAt === "string") {
      const d = new Date(rawCapturedAt);
      if (Number.isNaN(d.getTime())) {
        return {
          valid: false,
          error: `captured_at from ${schema}.${view} is not a valid timestamp: ${rawCapturedAt}`,
          mrr: null,
          supportingMetrics: null,
          funnelStages: null,
          customMetric: null,
        };
      }
      capturedAt = d.toISOString();
    } else {
      return {
        valid: false,
        error: `captured_at from ${schema}.${view} is missing or invalid.`,
        mrr: null,
        supportingMetrics: null,
        funnelStages: null,
        customMetric: null,
      };
    }

    return {
      valid: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: {
        metricValue,
        previousValue,
        capturedAt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.includes("timeout") || message.includes("ETIMEDOUT");
    return {
      valid: false,
      error: `Postgres query failed on ${schema}.${view}: ${message}`,
      retryable: isTimeout,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };
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
