// MCP REST route handlers.
// Wires all 8 tool service functions as REST endpoints under /api/mcp/*,
// applies API key auth middleware, and wraps responses in McpResponse<T>.

import type { SyncQueueProducer } from "../lib/connectors/queue";
import type { McpScope } from "../lib/mcp/auth";
import {
  authenticateMcpRequest,
  isMcpAuthError,
  type McpAuthContext,
  type McpAuthError,
  type McpRateLimiter,
} from "../lib/mcp/auth";
import type { TaskSyncQueueProducer } from "../lib/tasks/queue";
import {
  createTask,
  getActivityLog,
  getAlerts,
  getAtRiskCustomers,
  getMetrics,
  getPortfolioSummary,
  snoozeAlert,
  triggerSync,
} from "../services/mcp-tools";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DrizzleDb = ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;

interface McpDb {
  execute: (query: unknown) => Promise<{ rows: unknown[] }>;
}

export interface McpRestRuntime {
  db: { db: DrizzleDb };
  env: { webUrl: string };
  queueProducer: SyncQueueProducer;
  rateLimiter?: McpRateLimiter;
  taskSyncQueueProducer: TaskSyncQueueProducer;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapResponse<T>(
  data: T,
  url: string,
  pagination?: { cursor: string | null; hasMore: boolean; limit: number }
) {
  return {
    data,
    dataAsOf: new Date().toISOString(),
    dashboardUrl: url,
    ...(pagination ? { pagination } : {}),
  };
}

function buildDashboardUrl(webUrl: string, path = ""): string {
  const base = webUrl.replace(/\/$/, "");
  return `${base}${path}`;
}

type AuthResult =
  | { ok: true; ctx: McpAuthContext }
  | { ok: false; error: McpAuthError };

async function authenticate(
  request: Request,
  scope: McpScope,
  db: DrizzleDb,
  set: { status?: number | string },
  rateLimiter?: McpRateLimiter
): Promise<AuthResult> {
  const result = await authenticateMcpRequest(
    request,
    scope,
    db,
    set,
    rateLimiter
  );

  if (isMcpAuthError(result)) {
    return { ok: false, error: result };
  }

  return { ok: true, ctx: result };
}

// ---------------------------------------------------------------------------
// Read tool handlers
// ---------------------------------------------------------------------------

/** GET /api/mcp/metrics?startupId&metricKeys?&category? */
export async function handleMcpGetMetrics(
  runtime: McpRestRuntime,
  request: Request,
  query: { startupId?: string; metricKeys?: string; category?: string },
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "read",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  const startupId = query.startupId;
  if (!startupId) {
    set.status = 400;
    return {
      error: "startupId query parameter is required.",
      code: "BAD_REQUEST",
    };
  }

  const metricKeys = query.metricKeys
    ? query.metricKeys.split(",").map((k) => k.trim())
    : undefined;

  const data = await getMetrics(runtime.db.db as unknown as McpDb, {
    startupId,
    metricKeys,
    category: query.category,
  });

  return wrapResponse(
    data,
    buildDashboardUrl(runtime.env.webUrl, `/startups/${startupId}`)
  );
}

/** GET /api/mcp/alerts?startupId?&status? */
export async function handleMcpGetAlerts(
  runtime: McpRestRuntime,
  request: Request,
  query: { startupId?: string; status?: string },
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "read",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  const data = await getAlerts(runtime.db.db as unknown as McpDb, {
    workspaceId: auth.ctx.workspaceId,
    startupId: query.startupId,
    status: query.status,
  });

  return wrapResponse(data, buildDashboardUrl(runtime.env.webUrl, "/alerts"));
}

/** GET /api/mcp/at-risk-customers?startupId */
export async function handleMcpGetAtRiskCustomers(
  runtime: McpRestRuntime,
  request: Request,
  query: { startupId?: string },
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "read",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  const startupId = query.startupId;
  if (!startupId) {
    set.status = 400;
    return {
      error: "startupId query parameter is required.",
      code: "BAD_REQUEST",
    };
  }

  const data = await getAtRiskCustomers(
    runtime.db.db as unknown as McpDb,
    startupId
  );

  return wrapResponse(
    data,
    buildDashboardUrl(runtime.env.webUrl, `/startups/${startupId}`)
  );
}

/** GET /api/mcp/activity-log?startupId?&eventTypes?&cursor?&limit? */
export async function handleMcpGetActivityLog(
  runtime: McpRestRuntime,
  request: Request,
  query: {
    startupId?: string;
    eventTypes?: string;
    cursor?: string;
    limit?: string;
  },
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "read",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  const eventTypes = query.eventTypes
    ? query.eventTypes.split(",").map((e) => e.trim())
    : undefined;

  const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;

  const result = await getActivityLog(runtime.db.db as unknown as McpDb, {
    workspaceId: auth.ctx.workspaceId,
    startupId: query.startupId,
    eventTypes,
    cursor: query.cursor,
    limit,
  });

  return wrapResponse(
    result.entries,
    buildDashboardUrl(runtime.env.webUrl, "/activity"),
    result.pagination
  );
}

/** GET /api/mcp/portfolio-summary */
export async function handleMcpGetPortfolioSummary(
  runtime: McpRestRuntime,
  request: Request,
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "read",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  const data = await getPortfolioSummary(
    runtime.db.db as unknown as McpDb,
    auth.ctx.workspaceId
  );

  return wrapResponse(
    data,
    buildDashboardUrl(runtime.env.webUrl, "/dashboard")
  );
}

// ---------------------------------------------------------------------------
// Write tool handlers
// ---------------------------------------------------------------------------

/** POST /api/mcp/tasks */
export async function handleMcpCreateTask(
  runtime: McpRestRuntime,
  request: Request,
  body: {
    startupId?: string;
    title?: string;
    description?: string;
    priority?: string;
  },
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "write",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  if (!(body.startupId && body.title)) {
    set.status = 400;
    return {
      error: "startupId and title are required.",
      code: "BAD_REQUEST",
    };
  }

  const result = await createTask(
    runtime.db.db as unknown as McpDb,
    {
      startupId: body.startupId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      workspaceId: auth.ctx.workspaceId,
    },
    runtime.taskSyncQueueProducer
  );

  set.status = 201;
  return wrapResponse(
    result,
    buildDashboardUrl(runtime.env.webUrl, `/startups/${body.startupId}/tasks`)
  );
}

/** POST /api/mcp/alerts/:alertId/snooze */
export async function handleMcpSnoozeAlert(
  runtime: McpRestRuntime,
  request: Request,
  alertId: string,
  body: { durationHours?: number },
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "write",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  const result = await snoozeAlert(runtime.db.db as unknown as McpDb, {
    alertId,
    durationHours: body.durationHours,
    workspaceId: auth.ctx.workspaceId,
  });

  if (!result) {
    set.status = 404;
    return {
      error: "Alert not found or does not belong to your workspace.",
      code: "NOT_FOUND",
    };
  }

  return wrapResponse(
    { alert: result },
    buildDashboardUrl(runtime.env.webUrl, "/alerts")
  );
}

/** POST /api/mcp/sync */
export async function handleMcpTriggerSync(
  runtime: McpRestRuntime,
  request: Request,
  body: { startupId?: string; connectorId?: string },
  set: { status?: number | string }
) {
  const auth = await authenticate(
    request,
    "write",
    runtime.db.db,
    set,
    runtime.rateLimiter
  );
  if (!auth.ok) {
    return auth.error;
  }

  if (!body.startupId) {
    set.status = 400;
    return {
      error: "startupId is required.",
      code: "BAD_REQUEST",
    };
  }

  const result = await triggerSync(
    runtime.db.db as unknown as McpDb,
    {
      startupId: body.startupId,
      connectorId: body.connectorId,
      workspaceId: auth.ctx.workspaceId,
    },
    runtime.queueProducer
  );

  return wrapResponse(
    result,
    buildDashboardUrl(
      runtime.env.webUrl,
      `/startups/${body.startupId}/connectors`
    )
  );
}
