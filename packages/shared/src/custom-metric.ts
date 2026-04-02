// Custom metric contract shared across API, worker, and UI.
// Defines the narrow prepared-view setup contract for Postgres-backed metrics.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Prepared-view contract — identifier-safe schema.view plus fixed columns
// ---------------------------------------------------------------------------

/**
 * SQL identifier safety regex: 1–63 characters, starts with a letter or
 * underscore, contains only letters, digits, and underscores.
 * Prevents SQL injection via schema/view identifiers.
 */
const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

/** The three fixed columns every prepared view must expose. */
export const PREPARED_VIEW_COLUMNS = [
  "metric_value",
  "previous_value",
  "captured_at",
] as const;
export type PreparedViewColumn = (typeof PREPARED_VIEW_COLUMNS)[number];

export const CUSTOM_METRIC_STATUSES = ["pending", "active", "error"] as const;
export type CustomMetricStatus = (typeof CUSTOM_METRIC_STATUSES)[number];

// ---------------------------------------------------------------------------
// Zod schemas for API input validation
// ---------------------------------------------------------------------------

const sqlIdentifierSchema = z
  .string()
  .min(1, "Identifier must not be blank.")
  .max(63, "Identifier must be 63 characters or fewer.")
  .regex(
    SQL_IDENTIFIER_RE,
    "Identifier must be SQL-safe: start with a letter or underscore, and contain only letters, digits, and underscores."
  );

export const postgresSetupSchema = z.object({
  /** Connection URI — only postgres:// and postgresql:// schemes allowed. */
  connectionUri: z
    .string()
    .min(1, "Connection URI is required.")
    .refine(
      (uri) => {
        try {
          const url = new URL(uri);
          return url.protocol === "postgres:" || url.protocol === "postgresql:";
        } catch {
          return false;
        }
      },
      {
        message:
          "Connection URI must use the postgres:// or postgresql:// scheme.",
      }
    ),

  /** Identifier-safe schema name, e.g. "public". */
  schema: sqlIdentifierSchema,

  /** Identifier-safe view name, e.g. "daily_revenue". */
  view: sqlIdentifierSchema,

  /** Human-readable label shown on the dashboard, e.g. "Daily Revenue". */
  label: z
    .string()
    .min(1, "Label must not be blank.")
    .max(100, "Label must be 100 characters or fewer.")
    .transform((s) => s.trim()),

  /** Display unit, e.g. "$", "%", "users". */
  unit: z
    .string()
    .min(1, "Unit must not be blank.")
    .max(20, "Unit must be 20 characters or fewer.")
    .transform((s) => s.trim()),
});

export type PostgresSetupInput = z.infer<typeof postgresSetupSchema>;

// ---------------------------------------------------------------------------
// Custom metric summary — returned to the UI, never includes credentials
// ---------------------------------------------------------------------------

export interface CustomMetricSummary {
  /** ISO timestamp of the last successful metric capture. */
  capturedAt: string | null;
  connectorId: string;
  createdAt: string;
  id: string;
  label: string;
  /** Numeric value from the last successful sync, if any. */
  metricValue: number | null;
  previousValue: number | null;
  schema: string;
  startupId: string;
  status: CustomMetricStatus;
  unit: string;
  updatedAt: string;
  view: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function isCustomMetricStatus(
  value: string
): value is CustomMetricStatus {
  return CUSTOM_METRIC_STATUSES.includes(value as CustomMetricStatus);
}

export function isSqlIdentifierSafe(value: string): boolean {
  return SQL_IDENTIFIER_RE.test(value);
}
