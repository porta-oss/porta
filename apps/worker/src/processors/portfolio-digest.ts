// Portfolio digest processor.
// Generates a weekly AI-powered cross-startup analysis for each workspace.
// Loads all startups with health snapshots and metrics, builds a context string,
// calls the Anthropic API for cross-startup pattern analysis, and stores the
// result in the portfolio_digest table.

import { randomUUID } from "node:crypto";
import type { UniversalMetrics } from "@shared/universal-metrics";
import { UNIVERSAL_METRIC_KEYS } from "@shared/universal-metrics";
import type { Job } from "bullmq";
import { sql } from "drizzle-orm";
import type { PortfolioDigestJobPayload } from "../queues";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Drizzle-compatible db handle. */
interface DrizzleHandle {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

interface StartupWithHealth {
  activeAlerts: number;
  healthState: string;
  name: string;
  northStarDelta: number | null;
  northStarKey: string;
  northStarValue: number | null;
  startupId: string;
  supportingMetrics: UniversalMetrics;
  type: string;
}

/** Structured per-startup summary included in every digest. */
export interface StartupDigestEntry {
  activeAlerts: number;
  healthState: string;
  metrics: Record<string, number | null>;
  name: string;
  northStarDelta: number | null;
  northStarKey: string;
  northStarValue: number | null;
  type: string;
}

/** The full structured data stored in portfolio_digest.structured_data. */
export interface PortfolioDigestData {
  generatedAt: string;
  startups: StartupDigestEntry[];
}

/** Result returned from the processor for logging/testing. */
export interface PortfolioDigestResult {
  aiSynthesis: string | null;
  startupCount: number;
  synthesized: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_TIMEOUT_MS = 30_000;
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface PortfolioDigestProcessorDeps {
  anthropicApiKey: string | null;
  db: DrizzleHandle;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface StartupRow {
  id: string;
  name: string;
  north_star_key: string;
  type: string;
}

interface SnapshotRow {
  health_state: string;
  north_star_previous_value: string | null;
  north_star_value: string | null;
  startup_id: string;
  supporting_metrics: unknown;
}

interface AlertCountRow {
  count: number;
  startup_id: string;
}

async function loadStartupsWithHealth(
  db: DrizzleHandle,
  workspaceId: string
): Promise<StartupWithHealth[]> {
  const startupsResult = await db.execute(
    sql`SELECT id, name, type, north_star_key
        FROM startup
        WHERE workspace_id = ${workspaceId}
        ORDER BY name ASC`
  );

  const startups = startupsResult.rows as StartupRow[];
  if (startups.length === 0) {
    return [];
  }

  const startupIds = startups.map((s) => s.id);

  // Load health snapshots
  const snapshotResult = await db.execute(
    sql`SELECT startup_id, health_state, north_star_value, north_star_previous_value, supporting_metrics
        FROM health_snapshot
        WHERE startup_id IN (${sql.join(
          startupIds.map((id) => sql`${id}`),
          sql`, `
        )})`
  );

  const snapshotMap = new Map<string, SnapshotRow>();
  for (const row of snapshotResult.rows as SnapshotRow[]) {
    snapshotMap.set(row.startup_id, row);
  }

  // Load active alert counts
  const alertResult = await db.execute(
    sql`SELECT startup_id, COUNT(*)::int AS count
        FROM alert
        WHERE startup_id IN (${sql.join(
          startupIds.map((id) => sql`${id}`),
          sql`, `
        )})
          AND status = 'active'
        GROUP BY startup_id`
  );

  const alertCountMap = new Map<string, number>();
  for (const row of alertResult.rows as AlertCountRow[]) {
    alertCountMap.set(row.startup_id, row.count);
  }

  return startups.map((s) => {
    const snap = snapshotMap.get(s.id);
    const northStarValue =
      snap?.north_star_value == null ? null : Number(snap.north_star_value);
    const northStarPrev =
      snap?.north_star_previous_value == null
        ? null
        : Number(snap.north_star_previous_value);

    const supportingMetrics: UniversalMetrics = {} as UniversalMetrics;
    if (
      snap?.supporting_metrics &&
      typeof snap.supporting_metrics === "object"
    ) {
      const um = snap.supporting_metrics as UniversalMetrics;
      for (const key of UNIVERSAL_METRIC_KEYS) {
        supportingMetrics[key] = um[key] ?? null;
      }
    }

    return {
      startupId: s.id,
      name: s.name,
      type: s.type,
      northStarKey: s.north_star_key,
      northStarValue,
      northStarDelta:
        northStarValue != null && northStarPrev != null
          ? northStarValue - northStarPrev
          : null,
      healthState: snap?.health_state ?? "syncing",
      supportingMetrics,
      activeAlerts: alertCountMap.get(s.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

export function buildContextString(startups: StartupWithHealth[]): string {
  const lines: string[] = [];
  lines.push(`Portfolio of ${startups.length} startups:\n`);

  for (const s of startups) {
    lines.push(`## ${s.name} (${s.type})`);
    lines.push(`Health: ${s.healthState}`);
    lines.push(
      `North star (${s.northStarKey}): ${s.northStarValue ?? "N/A"}${s.northStarDelta == null ? "" : ` (delta: ${s.northStarDelta > 0 ? "+" : ""}${s.northStarDelta})`}`
    );
    lines.push(`Active alerts: ${s.activeAlerts}`);

    const metricLines: string[] = [];
    for (const key of UNIVERSAL_METRIC_KEYS) {
      const val = s.supportingMetrics[key];
      if (val != null) {
        metricLines.push(`  ${key}: ${val}`);
      }
    }
    if (metricLines.length > 0) {
      lines.push(`Metrics:\n${metricLines.join("\n")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-startup summary (used when <2 startups — no cross-comparison)
// ---------------------------------------------------------------------------

export function generatePerStartupSummary(
  startups: StartupWithHealth[]
): string {
  const lines: string[] = [];
  for (const s of startups) {
    lines.push(`${s.name} (${s.type}):`);
    lines.push(`- Health: ${s.healthState}`);
    lines.push(
      `- North star (${s.northStarKey}): ${s.northStarValue ?? "N/A"}${s.northStarDelta == null ? "" : ` (delta: ${s.northStarDelta > 0 ? "+" : ""}${s.northStarDelta})`}`
    );
    lines.push(`- Active alerts: ${s.activeAlerts}`);

    const metricBullets: string[] = [];
    for (const key of UNIVERSAL_METRIC_KEYS) {
      const val = s.supportingMetrics[key];
      if (val != null) {
        metricBullets.push(`  - ${key}: ${val}`);
      }
    }
    if (metricBullets.length > 0) {
      lines.push(`- Key metrics:\n${metricBullets.join("\n")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

interface AiSynthesisResult {
  latencyMs: number;
  synthesis: string;
  tokenUsage: { input: number; output: number };
}

async function callAnthropicForSynthesis(
  apiKey: string,
  contextString: string
): Promise<AiSynthesisResult> {
  const systemPrompt = `You are a portfolio analyst for a multi-startup founder. Given per-startup data including name, type, health state, key metrics with deltas, and active alert count, provide 3-5 bullet points identifying:
- Cross-startup patterns and correlations
- Relative performance comparisons
- Actionable recommendations backed by the data

Be concise, data-driven, and avoid speculation without evidence. Each bullet should start with a dash (-).`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: contextString }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      throw new Error(`Anthropic API returned status ${response.status}`);
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const textBlock = body.content?.find((block) => block.type === "text");
    if (!textBlock?.text) {
      throw new Error("Anthropic response contained no text block.");
    }

    return {
      synthesis: textBlock.text,
      latencyMs,
      tokenUsage: {
        input: body.usage?.input_tokens ?? 0,
        output: body.usage?.output_tokens ?? 0,
      },
    };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Anthropic portfolio synthesis timed out after ${ANTHROPIC_TIMEOUT_MS}ms.`
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function storeDigest(
  db: DrizzleHandle,
  workspaceId: string,
  structuredData: PortfolioDigestData,
  aiSynthesis: string | null,
  startupCount: number,
  synthesizedAt: Date | null
): Promise<void> {
  const id = randomUUID();
  const dataJson = JSON.stringify(structuredData);
  const synthesizedAtIso = synthesizedAt?.toISOString() ?? null;

  // Upsert: delete existing and insert new (same pattern as health_snapshot)
  await db.execute(
    sql`DELETE FROM portfolio_digest WHERE workspace_id = ${workspaceId}`
  );

  await db.execute(
    sql`INSERT INTO portfolio_digest (id, workspace_id, ai_synthesis, structured_data, startup_count, synthesized_at)
        VALUES (${id}, ${workspaceId}, ${aiSynthesis}, ${dataJson}::jsonb, ${startupCount}, ${synthesizedAtIso})`
  );
}

// ---------------------------------------------------------------------------
// Event logging (fire-and-forget)
// ---------------------------------------------------------------------------

async function logDigestEvent(
  db: DrizzleHandle,
  workspaceId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      sql`INSERT INTO event_log (id, workspace_id, event_type, actor_type, actor_id, payload)
          VALUES (${randomUUID()}, ${workspaceId}, ${eventType}, 'system', 'portfolio-digest-worker', ${JSON.stringify(payload)}::jsonb)`
    );
  } catch {
    // Fire-and-forget: event log writes must not crash the processor
  }
}

// ---------------------------------------------------------------------------
// Processor factory
// ---------------------------------------------------------------------------

export function createPortfolioDigestProcessor(
  deps: PortfolioDigestProcessorDeps
) {
  return async function processPortfolioDigestJob(
    job: Job<PortfolioDigestJobPayload>
  ): Promise<PortfolioDigestResult> {
    const { workspaceId } = job.data;
    const logCtx = { workspaceId, bullmqJobId: job.id };

    deps.log.info("portfolio digest started", logCtx);

    // Step 1: Load all startups with health data
    const startups = await loadStartupsWithHealth(deps.db, workspaceId);

    if (startups.length === 0) {
      deps.log.info("no startups found, skipping digest", logCtx);
      return { startupCount: 0, aiSynthesis: null, synthesized: false };
    }

    // Step 2: Build structured data
    const structuredData: PortfolioDigestData = {
      generatedAt: new Date().toISOString(),
      startups: startups.map((s) => ({
        name: s.name,
        type: s.type,
        healthState: s.healthState,
        northStarKey: s.northStarKey,
        northStarValue: s.northStarValue,
        northStarDelta: s.northStarDelta,
        activeAlerts: s.activeAlerts,
        metrics: Object.fromEntries(
          UNIVERSAL_METRIC_KEYS.map((k) => [k, s.supportingMetrics[k] ?? null])
        ),
      })),
    };

    // Step 3: Attempt AI synthesis or generate per-startup summary
    let aiSynthesis: string | null = null;
    let synthesizedAt: Date | null = null;

    if (startups.length < 2) {
      // <2 startups: generate per-startup summary text (no cross-comparison)
      aiSynthesis = generatePerStartupSummary(startups);
      synthesizedAt = new Date();

      deps.log.info(
        "fewer than 2 startups, generating per-startup summary only",
        logCtx
      );

      await logDigestEvent(deps.db, workspaceId, "insight.degraded", {
        reason: "insufficient_startups",
        startupCount: startups.length,
      });
    } else if (deps.anthropicApiKey) {
      // >=2 startups + API key: call Anthropic
      const contextString = buildContextString(startups);

      try {
        const result = await callAnthropicForSynthesis(
          deps.anthropicApiKey,
          contextString
        );

        aiSynthesis = result.synthesis;
        synthesizedAt = new Date();

        deps.log.info("AI synthesis completed", {
          ...logCtx,
          latencyMs: result.latencyMs,
          inputTokens: result.tokenUsage.input,
          outputTokens: result.tokenUsage.output,
        });

        // Log AI API usage: token count, latency, cost estimate
        const estimatedCost =
          (result.tokenUsage.input * 0.003 + result.tokenUsage.output * 0.015) /
          1000;

        await logDigestEvent(deps.db, workspaceId, "insight.generated", {
          source: "portfolio-digest",
          model: ANTHROPIC_MODEL,
          latencyMs: result.latencyMs,
          inputTokens: result.tokenUsage.input,
          outputTokens: result.tokenUsage.output,
          estimatedCost,
          startupCount: startups.length,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const isTimeout = error.includes("timed out");
        const reason = isTimeout ? "ai_timeout" : "ai_unavailable";

        deps.log.error("AI synthesis failed, storing metric-only digest", {
          ...logCtx,
          error,
          degradedReason: reason,
        });

        await logDigestEvent(deps.db, workspaceId, "insight.degraded", {
          reason,
          startupCount: startups.length,
        });
      }
    } else {
      // No API key: metric-only digest
      deps.log.info("no Anthropic API key, storing metric-only digest", logCtx);

      await logDigestEvent(deps.db, workspaceId, "insight.degraded", {
        reason: "ai_unavailable",
        startupCount: startups.length,
      });
    }

    // Step 4: Store digest
    await storeDigest(
      deps.db,
      workspaceId,
      structuredData,
      aiSynthesis,
      startups.length,
      synthesizedAt
    );

    deps.log.info("portfolio digest completed", {
      ...logCtx,
      startupCount: startups.length,
      hasSynthesis: aiSynthesis !== null,
    });

    return {
      startupCount: startups.length,
      aiSynthesis,
      synthesized: aiSynthesis !== null,
    };
  };
}
