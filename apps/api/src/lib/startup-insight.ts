// Startup insight read-model helpers.
// Loads the latest persisted insight for a given startup and returns
// an explicit status payload (ready, unavailable, blocked, error).
//
// The route handler calls `loadLatestInsight` which reads the insight row
// and returns the shared contract shape, preserving last-good semantics.
//
// The worker writes; the API reads; the UI renders.

import type {
  EvidencePacket,
  InsightConditionCode,
  InsightExplanation,
  InsightGenerationStatus,
  LatestInsightPayload,
} from "@shared/startup-insight";
import {
  isInsightConditionCode,
  isInsightGenerationStatus,
  validateEvidencePacket,
  validateInsightExplanation,
} from "@shared/startup-insight";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Insight display status surfaced to the UI. */
export type InsightDisplayStatus =
  | "ready"
  | "unavailable"
  | "blocked"
  | "error";

/** Full payload returned by the startup-insight route. */
export interface StartupInsightPayload {
  /** Diagnostic message for non-ready states. */
  diagnosticMessage: string | null;
  displayStatus: InsightDisplayStatus;
  insight: LatestInsightPayload | null;
}

/** Minimal DB interface — works with any Drizzle instance. */
interface InsightDb {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

// ---------------------------------------------------------------------------
// DB read
// ---------------------------------------------------------------------------

interface InsightRow {
  condition_code: string;
  evidence: unknown;
  explainer_latency_ms: number | null;
  explanation: unknown;
  generated_at: string | Date;
  generation_status: string;
  id: string;
  last_error: string | null;
  model: string | null;
  startup_id: string;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadInsightRow(
  db: InsightDb,
  startupId: string
): Promise<InsightRow | null> {
  const result = await db.execute(
    sql`SELECT id, startup_id, condition_code, evidence, explanation,
               generation_status, last_error, model, explainer_latency_ms,
               generated_at
        FROM startup_insight
        WHERE startup_id = ${startupId}
        LIMIT 1`
  );
  const row = result.rows[0] as InsightRow | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function computeDisplayStatus(row: InsightRow | null): {
  displayStatus: InsightDisplayStatus;
  diagnosticMessage: string | null;
} {
  if (!row) {
    return {
      displayStatus: "unavailable",
      diagnosticMessage:
        "No insight has been generated for this startup yet. Insights are created after the first data sync completes.",
    };
  }

  const status = row.generation_status;

  if (status === "success") {
    return { displayStatus: "ready", diagnosticMessage: null };
  }

  if (status === "skipped_blocked" || status === "skipped_stale") {
    return {
      displayStatus: "blocked",
      diagnosticMessage:
        status === "skipped_blocked"
          ? "Insight generation was blocked because connectors are not healthy. Reconnect your data sources to resume insights."
          : "Insight generation was skipped because the data is stale. Trigger a sync to refresh.",
    };
  }

  if (status === "skipped_no_condition") {
    // If there's a previous good explanation, show it as ready
    if (row.explanation !== null && row.explanation !== undefined) {
      return { displayStatus: "ready", diagnosticMessage: null };
    }
    return {
      displayStatus: "unavailable",
      diagnosticMessage:
        "No actionable condition was detected in the latest data. Insights will appear when a condition is identified.",
    };
  }

  if (status === "failed_explainer" || status === "failed_persistence") {
    // Preserve-last-good: if explanation exists from a previous success, show as ready
    if (row.explanation !== null && row.explanation !== undefined) {
      return {
        displayStatus: "ready",
        diagnosticMessage: `Last generation attempt failed (${row.last_error ?? "unknown error"}), but the previous insight is still shown.`,
      };
    }
    return {
      displayStatus: "error",
      diagnosticMessage:
        row.last_error ?? `Insight generation failed with status: ${status}.`,
    };
  }

  return {
    displayStatus: "error",
    diagnosticMessage: `Unknown generation status: ${status}.`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the latest insight payload for a given startup.
 * Returns an explicit display status with diagnostic messaging.
 */
export async function loadLatestInsight(
  db: InsightDb,
  startupId: string
): Promise<StartupInsightPayload> {
  const row = await loadInsightRow(db, startupId);

  const { displayStatus, diagnosticMessage } = computeDisplayStatus(row);

  if (!row) {
    return { insight: null, displayStatus, diagnosticMessage };
  }

  // Validate condition code
  if (!isInsightConditionCode(row.condition_code)) {
    throw new Error(
      `Malformed insight row for startup ${startupId}: invalid condition code "${row.condition_code}".`
    );
  }

  // Validate evidence
  const evidenceError = validateEvidencePacket(row.evidence);
  if (evidenceError) {
    throw new Error(
      `Malformed insight row for startup ${startupId}: ${evidenceError}`
    );
  }

  // Validate explanation (nullable)
  let explanation: InsightExplanation | null = null;
  if (row.explanation !== null && row.explanation !== undefined) {
    const explError = validateInsightExplanation(row.explanation);
    if (explError) {
      throw new Error(
        `Malformed insight row for startup ${startupId}: ${explError}`
      );
    }
    explanation = row.explanation as InsightExplanation;
  }

  // Validate generation status
  if (!isInsightGenerationStatus(row.generation_status)) {
    throw new Error(
      `Malformed insight row for startup ${startupId}: invalid generation status "${row.generation_status}".`
    );
  }

  const insight: LatestInsightPayload = {
    startupId: row.startup_id,
    conditionCode: row.condition_code as InsightConditionCode,
    evidence: row.evidence as EvidencePacket,
    explanation,
    generationStatus: row.generation_status as InsightGenerationStatus,
    generatedAt: toIsoString(row.generated_at),
    lastError: row.last_error,
  };

  return { insight, displayStatus, diagnosticMessage };
}
