// Telegram digest processor.
// Sends daily portfolio digests via Telegram Bot API.
// Queries active configs due for delivery, loads startup health data,
// renders sparkline PNGs, and sends MarkdownV2 formatted messages.

import type { Job } from "bullmq";
import { sql } from "drizzle-orm";
import type { TelegramJobPayload } from "../queues";
import { renderSparkline } from "../sparklines";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Drizzle-compatible db handle. */
interface DrizzleHandle {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

export interface TelegramSender {
  sendMessage(
    botToken: string,
    chatId: string,
    text: string,
    parseMode?: string
  ): Promise<TelegramApiResponse>;
  sendPhoto(
    botToken: string,
    chatId: string,
    photo: Buffer,
    caption?: string
  ): Promise<TelegramApiResponse>;
}

export interface TelegramApiResponse {
  description?: string;
  error_code?: number;
  ok: boolean;
}

export interface TelegramDigestProcessorDeps {
  db: DrizzleHandle;
  log: {
    error: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /** Clock override for testing — defaults to `() => new Date()`. */
  now?: () => Date;
  sender: TelegramSender;
}

// ---------------------------------------------------------------------------
// DB row shapes (snake_case from SQL)
// ---------------------------------------------------------------------------

interface TelegramConfigRow {
  bot_token: string;
  bot_username: string | null;
  chat_id: string;
  digest_time: string;
  digest_timezone: string;
  id: string;
  is_active: boolean;
  last_digest_at: Date | string | null;
  workspace_id: string;
}

interface StartupRow {
  id: string;
  name: string;
  north_star_key: string;
}

interface SnapshotRow {
  health_state: string;
  north_star_key: string;
  north_star_previous_value: string | null;
  north_star_value: string | null;
  supporting_metrics: Record<string, number> | string;
}

interface FunnelStageRow {
  key: string;
  label: string;
  value: number;
}

interface HistoryValueRow {
  value: string;
}

// ---------------------------------------------------------------------------
// MarkdownV2 helpers
// ---------------------------------------------------------------------------

const MD2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!]/g;

export function escMd2(text: string): string {
  return text.replace(MD2_SPECIAL, "\\$&");
}

function healthEmoji(state: string): string {
  switch (state) {
    case "ready":
      return "🟢";
    case "syncing":
      return "🔵";
    case "stale":
      return "🟡";
    case "blocked":
    case "error":
      return "🔴";
    default:
      return "⚪";
  }
}

function formatDelta(current: number | null, previous: number | null): string {
  if (current == null || previous == null || previous === 0) {
    return "";
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const arrow = pct >= 0 ? "↑" : "↓";
  return ` ${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Timezone helper
// ---------------------------------------------------------------------------

export function getCurrentTimeInTimezone(
  timezone: string,
  now: Date = new Date()
): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hour}:${minute}`;
  } catch {
    return "00:00";
  }
}

// ---------------------------------------------------------------------------
// Default Telegram sender (real HTTP calls)
// ---------------------------------------------------------------------------

export function createDefaultTelegramSender(): TelegramSender {
  return {
    async sendMessage(botToken, chatId, text, parseMode) {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return response.json() as Promise<TelegramApiResponse>;
    },

    async sendPhoto(botToken, chatId, photo, caption) {
      const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append(
        "photo",
        new Blob([new Uint8Array(photo)], { type: "image/png" }),
        "sparkline.png"
      );
      if (caption) {
        formData.append("caption", caption);
      }
      const response = await fetch(url, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(10_000),
      });
      return response.json() as Promise<TelegramApiResponse>;
    },
  };
}

// ---------------------------------------------------------------------------
// Processor factory
// ---------------------------------------------------------------------------

export function createTelegramDigestProcessor(
  deps: TelegramDigestProcessorDeps
) {
  return async function processTelegramDigestJob(
    job: Job<TelegramJobPayload>
  ): Promise<void> {
    if (job.data.type !== "digest") {
      return;
    }

    deps.log.info("telegram digest check started", { bullmqJobId: job.id });

    // 1. Query all active, linked telegram configs
    const configResult = await deps.db.execute(
      sql`SELECT id, workspace_id, bot_token, bot_username, chat_id,
                 digest_time, digest_timezone, is_active, last_digest_at
          FROM telegram_config
          WHERE is_active = true AND chat_id IS NOT NULL`
    );
    const configs = configResult.rows as TelegramConfigRow[];
    const now = deps.now?.() ?? new Date();

    // 2. Filter configs where current time matches digest_time in timezone
    const dueConfigs = configs.filter((config) => {
      const currentTime = getCurrentTimeInTimezone(config.digest_timezone, now);
      if (currentTime !== config.digest_time) {
        return false;
      }
      // Prevent duplicate sends within 23 hours
      if (config.last_digest_at) {
        const lastSent = new Date(config.last_digest_at);
        const hoursSince =
          (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 23) {
          return false;
        }
      }
      return true;
    });

    if (dueConfigs.length === 0) {
      deps.log.info("telegram digest check complete, no configs due", {
        totalConfigs: configs.length,
      });
      return;
    }

    deps.log.info("telegram digest configs due", {
      count: dueConfigs.length,
    });

    // 3. Process each due config
    for (const config of dueConfigs) {
      try {
        await processDigestForConfig(deps, config, now);
      } catch (err) {
        deps.log.error("telegram digest failed for workspace", {
          workspaceId: config.workspace_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    deps.log.info("telegram digest check complete", {
      processed: dueConfigs.length,
    });
  };
}

// ---------------------------------------------------------------------------
// Per-workspace digest processing
// ---------------------------------------------------------------------------

/** Data loaded per startup for digest rendering. */
interface StartupDigestData {
  alertCount: number;
  funnelStages: FunnelStageRow[];
  historyValues: number[];
  snap: SnapshotRow | undefined;
  startup: StartupRow;
}

/** Load health data for a single startup. */
async function loadStartupDigestData(
  db: DrizzleHandle,
  su: StartupRow,
  now: Date
): Promise<StartupDigestData> {
  const snapResult = await db.execute(
    sql`SELECT health_state, north_star_key, north_star_value,
               north_star_previous_value, supporting_metrics
        FROM health_snapshot WHERE startup_id = ${su.id} LIMIT 1`
  );
  const snap = (snapResult.rows as SnapshotRow[])[0];

  const alertResult = await db.execute(
    sql`SELECT COUNT(*)::text AS count FROM alert
        WHERE startup_id = ${su.id} AND status = 'active'`
  );
  const alertCount = Number(
    (alertResult.rows as Array<{ count: string }>)[0]?.count ?? "0"
  );

  const funnelResult = await db.execute(
    sql`SELECT key, label, value FROM health_funnel_stage
        WHERE startup_id = ${su.id} ORDER BY position ASC`
  );

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const historyResult = await db.execute(
    sql`SELECT value FROM health_snapshot_history
        WHERE startup_id = ${su.id}
          AND metric_key = ${su.north_star_key}
          AND captured_at >= ${sevenDaysAgo}
        ORDER BY captured_at ASC`
  );

  return {
    alertCount,
    funnelStages: funnelResult.rows as FunnelStageRow[],
    historyValues: (historyResult.rows as HistoryValueRow[]).map((r) =>
      Number(r.value)
    ),
    snap,
    startup: su,
  };
}

/** Parse supporting metrics from snapshot (handles JSON string or object). */
function parseSupportingMetrics(
  raw: Record<string, number> | string | null | undefined
): Record<string, number> | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === "string") {
    return JSON.parse(raw) as Record<string, number>;
  }
  return raw;
}

/** Build MarkdownV2 text section for a single startup. */
function buildStartupSection(
  data: StartupDigestData,
  hasSparkline: boolean
): string {
  const { alertCount, funnelStages, historyValues, snap, startup } = data;

  const healthState = snap?.health_state ?? "stale";
  const nsValue =
    snap?.north_star_value == null ? null : Number(snap.north_star_value);
  const nsPrev =
    snap?.north_star_previous_value == null
      ? null
      : Number(snap.north_star_previous_value);
  const delta = formatDelta(nsValue, nsPrev);

  let trendIndicator = "";
  if (!hasSparkline && historyValues.length >= 2) {
    const last = historyValues.at(-1) ?? 0;
    trendIndicator = historyValues[0] <= last ? " 📈" : " 📉";
  }

  const nsLabel = escMd2(
    startup.north_star_key.toUpperCase().replace(/_/g, " ")
  );
  const nsDisplay = nsValue == null ? "\\-" : escMd2(String(nsValue));

  let section = `${healthEmoji(healthState)} *${escMd2(startup.name)}*\n`;
  section += `Health: ${escMd2(healthState)}${trendIndicator}\n`;
  section += `${nsLabel}: ${nsDisplay}${escMd2(delta)}\n`;

  if (alertCount > 0) {
    section += `⚠️ ${alertCount} active alert${alertCount > 1 ? "s" : ""}\n`;
  }

  const metrics = parseSupportingMetrics(snap?.supporting_metrics);
  if (metrics?.churn_rate != null) {
    section += `Churn: ${escMd2(String(metrics.churn_rate))}%\n`;
  }

  const atRiskStages = funnelStages.filter(
    (s) => s.key.includes("at_risk") || s.key.includes("churning")
  );
  for (const stage of atRiskStages) {
    section += `👥 ${escMd2(stage.label)}: ${stage.value}\n`;
  }

  return section;
}

async function processDigestForConfig(
  deps: TelegramDigestProcessorDeps,
  config: TelegramConfigRow,
  now: Date
): Promise<void> {
  const { db, log, sender } = deps;

  const startupResult = await db.execute(
    sql`SELECT id, name, north_star_key FROM startup
        WHERE workspace_id = ${config.workspace_id}
        ORDER BY name ASC`
  );
  const startups = startupResult.rows as StartupRow[];

  if (startups.length === 0) {
    log.info("no startups for workspace, skipping digest", {
      workspaceId: config.workspace_id,
    });
    return;
  }

  const sections: string[] = [];

  for (const su of startups) {
    const data = await loadStartupDigestData(db, su, now);

    // Render and send sparkline photo
    let hasSparkline = false;
    if (data.historyValues.length >= 2) {
      const sparklinePng = await renderSparkline(data.historyValues);
      if (sparklinePng) {
        const caption = `${su.name} — 7d ${su.north_star_key}`;
        const photoResult = await sender.sendPhoto(
          config.bot_token,
          config.chat_id,
          sparklinePng,
          caption
        );
        if (!photoResult.ok && photoResult.error_code === 403) {
          await deactivateConfig(db, log, config);
          return;
        }
        hasSparkline = true;
      }
    }

    sections.push(buildStartupSection(data, hasSparkline));
  }

  // Send consolidated digest message
  const fullMessage = `📊 *Daily Portfolio Digest*\n\n${sections.join("\n")}`;
  const msgResult = await sender.sendMessage(
    config.bot_token,
    config.chat_id,
    fullMessage,
    "MarkdownV2"
  );

  if (!msgResult.ok) {
    if (msgResult.error_code === 403) {
      await deactivateConfig(db, log, config);
      return;
    }
    throw new Error(
      `Telegram sendMessage failed: ${msgResult.description ?? "unknown error"}`
    );
  }

  // Update last_digest_at
  await db.execute(
    sql`UPDATE telegram_config SET last_digest_at = ${now}
        WHERE id = ${config.id}`
  );

  // Log telegram.digest event (fire-and-forget)
  const eventPayload = JSON.stringify({
    chatId: config.chat_id,
    metricsIncluded: startups.length,
    startupCount: startups.length,
  });
  db.execute(
    sql`INSERT INTO event_log (id, workspace_id, startup_id, event_type, actor_type, actor_id, payload, created_at)
        VALUES (gen_random_uuid(), ${config.workspace_id}, NULL, 'telegram.digest', 'system', NULL, ${eventPayload}::jsonb, ${now})`
  ).catch(() => {
    // Fire-and-forget — event log failures must not block digest delivery
  });

  log.info("telegram digest sent", {
    workspaceId: config.workspace_id,
    startupCount: startups.length,
    metricsIncluded: startups.length,
  });
}

// ---------------------------------------------------------------------------
// Handle 403 — bot removed by user
// ---------------------------------------------------------------------------

async function deactivateConfig(
  db: DrizzleHandle,
  log: TelegramDigestProcessorDeps["log"],
  config: TelegramConfigRow
): Promise<void> {
  log.warn("telegram bot removed, deactivating config", {
    workspaceId: config.workspace_id,
    configId: config.id,
  });
  await db.execute(
    sql`UPDATE telegram_config SET is_active = false WHERE id = ${config.id}`
  );
}
