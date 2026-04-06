// Native MCP protocol plugin via elysia-mcp.
// Registers all 8 tools with Zod input schemas from @porta/shared,
// authenticates via Bearer API key, and mounts at /mcp.

import { createHash } from "node:crypto";

import {
  createTaskInputSchema,
  getActivityLogInputSchema,
  getAlertsInputSchema,
  getAtRiskCustomersInputSchema,
  getMetricsInputSchema,
  getPortfolioSummaryInputSchema,
  snoozeAlertInputSchema,
  triggerSyncInputSchema,
} from "@shared/mcp";
import { eq } from "drizzle-orm";
import { mcp } from "elysia-mcp";

import { apiKey } from "../db/schema/api-key";
import type { SyncQueueProducer } from "../lib/connectors/queue";
import type { McpRateLimiter, McpScope } from "../lib/mcp/auth";
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

export interface McpPluginRuntime {
  db: DrizzleDb;
  queueProducer: SyncQueueProducer;
  rateLimiter?: McpRateLimiter;
  taskSyncQueueProducer: TaskSyncQueueProducer;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function requireScope(
  scopes: string[] | undefined,
  required: McpScope
): boolean {
  if (!scopes) {
    return false;
  }
  if (required === "read") {
    return scopes.includes("read") || scopes.includes("write");
  }
  return scopes.includes("write");
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createMcpPlugin(runtime: McpPluginRuntime) {
  const db = runtime.db;

  return mcp({
    basePath: "/mcp",
    serverInfo: { name: "porta", version: "1.0.0" },
    capabilities: { tools: {} },
    stateless: true,

    authentication: async (context) => {
      const header = context.headers.authorization as string | undefined;
      if (!header?.startsWith("Bearer ")) {
        return {
          response: new Response(
            JSON.stringify({
              error: "Missing or malformed Authorization header.",
              code: "UNAUTHORIZED",
            }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          ),
        };
      }

      const token = header.slice(7);
      const hash = hashKey(token);

      const [record] = await db
        .select()
        .from(apiKey)
        .where(eq(apiKey.keyHash, hash))
        .limit(1);

      if (!record || record.revokedAt) {
        return {
          response: new Response(
            JSON.stringify({
              error: record ? "API key has been revoked." : "Invalid API key.",
              code: "UNAUTHORIZED",
            }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          ),
        };
      }

      // Rate limit check
      if (runtime.rateLimiter) {
        const rateResult = await runtime.rateLimiter.check(record.id);
        if (!rateResult.allowed) {
          return {
            response: new Response(
              JSON.stringify({
                error: "Rate limit exceeded. Maximum 60 requests per minute.",
                code: "RATE_LIMITED",
                retryAfter: rateResult.retryAfter,
              }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  ...(rateResult.retryAfter
                    ? { "Retry-After": String(rateResult.retryAfter) }
                    : {}),
                },
              }
            ),
          };
        }
      }

      // Update last_used_at (fire-and-forget)
      void db
        .update(apiKey)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKey.id, record.id));

      return {
        authInfo: {
          token,
          clientId: record.id,
          scopes: [record.scope as string],
          extra: {
            workspaceId: record.workspaceId,
            keyPrefix: record.keyPrefix,
          },
        },
      };
    },

    setupServer: async (server) => {
      // ---------------------------------------------------------------
      // Read tools (require "read" scope)
      // ---------------------------------------------------------------

      server.registerTool(
        "get_metrics",
        {
          title: "Get Metrics",
          description:
            "Retrieve startup metrics (MRR, churn, growth, custom metrics). Returns universal and custom metric values for a given startup.",
          inputSchema: getMetricsInputSchema.shape,
        },
        async (args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "read")) {
            return errorResult("Insufficient scope. Requires read access.");
          }
          const data = await getMetrics(db as unknown as McpDb, {
            startupId: args.startupId,
            metricKeys: args.metricKeys,
            category: args.category,
          });
          return textResult(data);
        }
      );

      server.registerTool(
        "get_alerts",
        {
          title: "Get Alerts",
          description:
            "List alerts across startups, optionally filtered by startup and status. Sorted by severity then fired date.",
          inputSchema: getAlertsInputSchema.shape,
        },
        async (args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "read")) {
            return errorResult("Insufficient scope. Requires read access.");
          }
          const workspaceId = (
            extra.authInfo?.extra as { workspaceId: string } | undefined
          )?.workspaceId;
          if (!workspaceId) {
            return errorResult("No workspace context.");
          }

          const data = await getAlerts(db as unknown as McpDb, {
            workspaceId,
            startupId: args.startupId,
            status: args.status,
          });
          return textResult(data);
        }
      );

      server.registerTool(
        "get_at_risk_customers",
        {
          title: "Get At-Risk Customers",
          description:
            "Retrieve customers identified as at-risk for a specific startup, with risk reasons and last activity dates.",
          inputSchema: getAtRiskCustomersInputSchema.shape,
        },
        async (args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "read")) {
            return errorResult("Insufficient scope. Requires read access.");
          }
          const data = await getAtRiskCustomers(
            db as unknown as McpDb,
            args.startupId
          );
          return textResult(data);
        }
      );

      server.registerTool(
        "get_activity_log",
        {
          title: "Get Activity Log",
          description:
            "Browse the event log with optional filters by startup, event types, and cursor-based pagination.",
          inputSchema: getActivityLogInputSchema.shape,
        },
        async (args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "read")) {
            return errorResult("Insufficient scope. Requires read access.");
          }
          const workspaceId = (
            extra.authInfo?.extra as { workspaceId: string } | undefined
          )?.workspaceId;
          if (!workspaceId) {
            return errorResult("No workspace context.");
          }

          const result = await getActivityLog(db as unknown as McpDb, {
            workspaceId,
            startupId: args.startupId,
            eventTypes: args.eventTypes,
            cursor: args.cursor,
            limit: args.limit,
          });
          return textResult(result);
        }
      );

      server.registerTool(
        "get_portfolio_summary",
        {
          title: "Get Portfolio Summary",
          description:
            "Overview of all startups in the workspace with health state, north star metrics, active alerts, and AI synthesis.",
          inputSchema: getPortfolioSummaryInputSchema.shape,
        },
        async (_args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "read")) {
            return errorResult("Insufficient scope. Requires read access.");
          }
          const workspaceId = (
            extra.authInfo?.extra as { workspaceId: string } | undefined
          )?.workspaceId;
          if (!workspaceId) {
            return errorResult("No workspace context.");
          }

          const data = await getPortfolioSummary(
            db as unknown as McpDb,
            workspaceId
          );
          return textResult(data);
        }
      );

      // ---------------------------------------------------------------
      // Write tools (require "write" scope)
      // ---------------------------------------------------------------

      server.registerTool(
        "create_task",
        {
          title: "Create Task",
          description:
            "Create a new task for a startup. Automatically syncs to Linear if configured.",
          inputSchema: createTaskInputSchema.shape,
        },
        async (args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "write")) {
            return errorResult(
              "Insufficient scope. This tool requires write access."
            );
          }
          const workspaceId = (
            extra.authInfo?.extra as { workspaceId: string } | undefined
          )?.workspaceId;
          if (!workspaceId) {
            return errorResult("No workspace context.");
          }

          const result = await createTask(
            db as unknown as McpDb,
            {
              startupId: args.startupId,
              title: args.title,
              description: args.description,
              priority: args.priority,
              workspaceId,
            },
            runtime.taskSyncQueueProducer
          );
          return textResult(result);
        }
      );

      server.registerTool(
        "snooze_alert",
        {
          title: "Snooze Alert",
          description:
            "Snooze an active alert for a specified duration (default 24 hours, max 168).",
          inputSchema: snoozeAlertInputSchema.shape,
        },
        async (args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "write")) {
            return errorResult(
              "Insufficient scope. This tool requires write access."
            );
          }
          const workspaceId = (
            extra.authInfo?.extra as { workspaceId: string } | undefined
          )?.workspaceId;
          if (!workspaceId) {
            return errorResult("No workspace context.");
          }

          const result = await snoozeAlert(db as unknown as McpDb, {
            alertId: args.alertId,
            durationHours: args.duration,
            workspaceId,
          });

          if (!result) {
            return errorResult(
              "Alert not found or does not belong to your workspace."
            );
          }
          return textResult({ alert: result });
        }
      );

      server.registerTool(
        "trigger_sync",
        {
          title: "Trigger Sync",
          description:
            "Trigger a data sync for a startup's connectors. Optionally target a specific connector.",
          inputSchema: triggerSyncInputSchema.shape,
        },
        async (args, extra) => {
          if (!requireScope(extra.authInfo?.scopes, "write")) {
            return errorResult(
              "Insufficient scope. This tool requires write access."
            );
          }
          const workspaceId = (
            extra.authInfo?.extra as { workspaceId: string } | undefined
          )?.workspaceId;
          if (!workspaceId) {
            return errorResult("No workspace context.");
          }

          const result = await triggerSync(
            db as unknown as McpDb,
            {
              startupId: args.startupId,
              connectorId: args.connectorId,
              workspaceId,
            },
            runtime.queueProducer
          );
          return textResult(result);
        }
      );
    },
  });
}
