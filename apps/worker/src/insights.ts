// Insight generation module.
// Detects one deterministic v1 condition from the latest health snapshot,
// builds a bounded evidence packet, and explains it through a swappable
// explainer interface. Preserves the last good insight when the explainer
// or underlying data is not trustworthy enough.
//
// Never persists raw connector configs, provider payloads, or unredacted
// prompt content in insight data.

import { randomUUID } from "node:crypto";
import type {
  HealthState,
  SupportingMetricsSnapshot,
} from "@shared/startup-health";
import type {
  EvidenceItem,
  EvidencePacket,
  InsightAction,
  InsightConditionCode,
  InsightExplanation,
} from "@shared/startup-insight";
import {
  computeDirection,
  validateEvidencePacket,
  validateInsightExplanation,
} from "@shared/startup-insight";

import type {
  HealthSnapshotRepository,
  HealthSnapshotRow,
  InsightRepository,
} from "./repository.js";

// ---------------------------------------------------------------------------
// Explainer interface — swappable for testing
// ---------------------------------------------------------------------------

/** Input to the explainer boundary. */
export interface ExplainerInput {
  conditionCode: InsightConditionCode;
  evidence: EvidencePacket;
}

/** Raw output from the explainer (before validation). */
export interface ExplainerOutput {
  actions: InsightAction[];
  hypothesis: string;
  latencyMs: number;
  model: string;
  observation: string;
}

/** Explainer function signature — implementations must respect timeout. */
export type ExplainerFn = (input: ExplainerInput) => Promise<ExplainerOutput>;

// ---------------------------------------------------------------------------
// Anthropic production explainer
// ---------------------------------------------------------------------------

const ANTHROPIC_TIMEOUT_MS = 15_000;
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

function getRetryableError(message: string): Error & { retryable: boolean } {
  const error = new Error(message) as Error & { retryable: boolean };
  error.retryable = true;
  return error;
}

function getAnthropicStatusError(status: number): Error | null {
  if (status === 401) {
    return new Error("Anthropic API key is invalid or revoked.");
  }
  if (status === 429) {
    return getRetryableError("Anthropic rate limit exceeded.");
  }
  if (status >= 500) {
    return getRetryableError(`Anthropic server error (${status}).`);
  }
  if (status >= 400) {
    return new Error(`Anthropic API returned status ${status}.`);
  }

  return null;
}

function extractAnthropicTextBlock(body: {
  content?: Array<{ type: string; text?: string }>;
}): string {
  const textBlock = body.content?.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic response contained no text block.");
  }

  return textBlock.text;
}

function parseAnthropicResponseText(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Anthropic response was not valid JSON.");
  }

  const payload = parsed as Record<string, unknown>;
  return {
    observation: String(payload.observation ?? ""),
    hypothesis: String(payload.hypothesis ?? ""),
    actions: (Array.isArray(payload.actions)
      ? payload.actions
      : []) as InsightAction[],
  };
}

/**
 * Create an Anthropic-backed explainer.
 * Calls the Messages API to generate an explanation from evidence data.
 */
export function createAnthropicExplainer(apiKey: string): ExplainerFn {
  return async (input: ExplainerInput): Promise<ExplainerOutput> => {
    const start = Date.now();

    const systemPrompt = `You are a B2B SaaS metrics analyst for startup founders. Given evidence data about a detected condition in their metrics, provide:
1. An "observation" — a clear, factual statement of what the data shows (1–2 sentences).
2. A "hypothesis" — why this might be happening based on common B2B SaaS patterns (1–2 sentences).
3. 1–3 concrete "actions" the founder should take, each with a short "label" (imperative, 3–6 words) and a one-sentence "rationale".

Respond ONLY with valid JSON matching this shape:
{
  "observation": "string",
  "hypothesis": "string",
  "actions": [{ "label": "string", "rationale": "string" }]
}

Do not include markdown, code fences, or any text outside the JSON object.`;

    const userPrompt = `Condition: ${input.conditionCode}
Evidence items:
${input.evidence.items.map((item) => `- ${item.label}: ${item.currentValue}${item.previousValue === null ? "" : ` (was ${item.previousValue}, direction: ${item.direction})`}`).join("\n")}
Snapshot computed at: ${input.evidence.snapshotComputedAt}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

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
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      const statusError = getAnthropicStatusError(response.status);
      if (statusError) {
        throw statusError;
      }

      const body = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const parsed = parseAnthropicResponseText(
        extractAnthropicTextBlock(body)
      );
      return {
        observation: parsed.observation,
        hypothesis: parsed.hypothesis,
        actions: parsed.actions,
        model: ANTHROPIC_MODEL,
        latencyMs,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw getRetryableError(
          `Anthropic explainer timed out after ${ANTHROPIC_TIMEOUT_MS}ms.`
        );
      }
      throw err;
    }
  };
}

/**
 * Create a deterministic test stub explainer.
 * Returns predictable output without needing API keys.
 */
export function createStubExplainer(
  overrides: Partial<ExplainerOutput> = {}
): ExplainerFn & { calls: ExplainerInput[] } {
  const calls: ExplainerInput[] = [];
  const fn = async (input: ExplainerInput): Promise<ExplainerOutput> => {
    calls.push(input);
    return {
      observation:
        overrides.observation ??
        `Detected ${input.conditionCode} from recent data.`,
      hypothesis:
        overrides.hypothesis ??
        "This may indicate a shift in user engagement patterns.",
      actions: overrides.actions ?? [
        {
          label: "Review recent cohorts",
          rationale: "Identify which segments are most affected.",
        },
        {
          label: "Check pricing page analytics",
          rationale: "See if conversion friction increased.",
        },
      ],
      model: overrides.model ?? "stub-model",
      latencyMs: overrides.latencyMs ?? 42,
    };
  };
  fn.calls = calls;
  return fn;
}

/**
 * Create a failing test stub explainer.
 * Throws the specified error on every call.
 */
export function createFailingExplainer(
  error = "Explainer unavailable",
  opts: { retryable?: boolean } = {}
): ExplainerFn & { calls: ExplainerInput[] } {
  const calls: ExplainerInput[] = [];
  const fn = async (input: ExplainerInput): Promise<ExplainerOutput> => {
    calls.push(input);
    const err = new Error(error);
    if (opts.retryable) {
      (err as Error & { retryable: boolean }).retryable = true;
    }
    throw err;
  };
  fn.calls = calls;
  return fn;
}

/**
 * Create a deterministic founder-proof explainer.
 * Returns a realistic, grounded explanation based on the detected condition
 * without calling any external API. Preserves the same contract shape as
 * the real Anthropic explainer.
 */
export function createFounderProofExplainer(): ExplainerFn {
  return async (input: ExplainerInput): Promise<ExplainerOutput> => {
    const conditionLabels: Record<
      Exclude<InsightConditionCode, "funnel_bottleneck">,
      { observation: string; hypothesis: string; actions: InsightAction[] }
    > = {
      mrr_declining: {
        observation:
          "MRR has declined over the most recent sync period, with revenue trending below previous levels.",
        hypothesis:
          "This could indicate increased churn or a slowdown in new subscription growth during the period.",
        actions: [
          {
            label: "Review recent cancellations",
            rationale:
              "Identify whether churn is concentrated in specific cohorts or plan tiers.",
          },
          {
            label: "Audit pricing page conversion",
            rationale:
              "Check if recent changes affected signup-to-paid conversion rates.",
          },
        ],
      },
      churn_spike: {
        observation:
          "Churn rate has spiked above normal thresholds in the latest data.",
        hypothesis:
          "A product issue, pricing change, or competitive pressure may be driving increased cancellations.",
        actions: [
          {
            label: "Survey churned customers",
            rationale:
              "Direct feedback reveals whether the cause is product, price, or support related.",
          },
          {
            label: "Check support ticket volume",
            rationale:
              "A spike in tickets before churn often points to unresolved product issues.",
          },
        ],
      },
      trial_conversion_drop: {
        observation:
          "Trial-to-paid conversion has dropped compared to the prior period.",
        hypothesis:
          "Onboarding friction or a change in traffic quality may be reducing conversion rates.",
        actions: [
          {
            label: "Review onboarding funnel",
            rationale:
              "Identify which step has the highest drop-off to target improvements.",
          },
          {
            label: "Compare traffic sources",
            rationale:
              "New channels may bring less qualified leads that convert at lower rates.",
          },
        ],
      },
      no_condition_detected: {
        observation:
          "All tracked metrics are within normal ranges for the current period.",
        hypothesis:
          "The business is operating steadily without any detected anomalies.",
        actions: [
          {
            label: "Review growth levers",
            rationale:
              "Stable periods are ideal for experimenting with new acquisition channels.",
          },
        ],
      },
    };

    const template =
      input.conditionCode === "funnel_bottleneck"
        ? conditionLabels.no_condition_detected
        : conditionLabels[input.conditionCode];

    return {
      observation: template.observation,
      hypothesis: template.hypothesis,
      actions: template.actions,
      model: "founder-proof-deterministic",
      latencyMs: 1,
    };
  };
}

// ---------------------------------------------------------------------------
// Condition detection — deterministic from health snapshot data
// ---------------------------------------------------------------------------

/** Threshold constants for condition detection. */
const MRR_DECLINE_THRESHOLD = 0.05; // 5% decline triggers mrr_declining
const CHURN_SPIKE_THRESHOLD = 10; // Churn rate > 10% triggers churn_spike
const TRIAL_CONVERSION_DECLINE_THRESHOLD = 0.1; // 10% drop triggers trial_conversion_drop

export interface DetectionInput {
  /** Health state of the connector (for freshness check). */
  healthState: HealthState;
  /** Current health snapshot. */
  snapshot: HealthSnapshotRow;
  /** Parsed supporting metrics from the snapshot. */
  supportingMetrics: SupportingMetricsSnapshot;
}

export interface DetectionResult {
  conditionCode: InsightConditionCode;
  evidence: EvidencePacket;
}

/**
 * Detect one deterministic condition from the health snapshot.
 * Returns the highest-priority condition found, or 'no_condition_detected'.
 * Priority order: mrr_declining > churn_spike > trial_conversion_drop > funnel_bottleneck
 */
export function detectCondition(input: DetectionInput): DetectionResult {
  const { snapshot, supportingMetrics } = input;
  const snapshotComputedAt =
    snapshot.computedAt instanceof Date
      ? snapshot.computedAt.toISOString()
      : String(snapshot.computedAt);
  const syncJobId = snapshot.syncJobId ?? null;

  // Check MRR decline
  const mrr = snapshot.northStarValue;
  const prevMrr = snapshot.northStarPreviousValue;
  if (
    prevMrr !== null &&
    prevMrr > 0 &&
    mrr < prevMrr &&
    (prevMrr - mrr) / prevMrr >= MRR_DECLINE_THRESHOLD
  ) {
    const items: EvidenceItem[] = [
      {
        metricKey: "mrr",
        label: "Monthly Recurring Revenue",
        currentValue: mrr,
        previousValue: prevMrr,
        direction: "down",
      },
    ];
    // Add supporting context if churn is elevated
    const churn = supportingMetrics.churn_rate;
    if (churn.value > 5) {
      items.push({
        metricKey: "churn_rate",
        label: "Churn Rate",
        currentValue: churn.value,
        previousValue: churn.previous,
        direction: computeDirection(churn.value, churn.previous),
      });
    }
    return {
      conditionCode: "mrr_declining",
      evidence: {
        conditionCode: "mrr_declining",
        items,
        snapshotComputedAt,
        syncJobId,
      },
    };
  }

  // Check churn spike
  const churnRate = supportingMetrics.churn_rate;
  if (churnRate.value > CHURN_SPIKE_THRESHOLD) {
    const items: EvidenceItem[] = [
      {
        metricKey: "churn_rate",
        label: "Churn Rate",
        currentValue: churnRate.value,
        previousValue: churnRate.previous,
        direction: computeDirection(churnRate.value, churnRate.previous),
      },
      {
        metricKey: "customer_count",
        label: "Customer Count",
        currentValue: supportingMetrics.customer_count.value,
        previousValue: supportingMetrics.customer_count.previous,
        direction: computeDirection(
          supportingMetrics.customer_count.value,
          supportingMetrics.customer_count.previous
        ),
      },
    ];
    return {
      conditionCode: "churn_spike",
      evidence: {
        conditionCode: "churn_spike",
        items,
        snapshotComputedAt,
        syncJobId,
      },
    };
  }

  // Check trial conversion drop
  const trialConversion = supportingMetrics.trial_conversion_rate;
  if (
    trialConversion.previous !== null &&
    trialConversion.previous > 0 &&
    trialConversion.value < trialConversion.previous &&
    (trialConversion.previous - trialConversion.value) /
      trialConversion.previous >=
      TRIAL_CONVERSION_DECLINE_THRESHOLD
  ) {
    const items: EvidenceItem[] = [
      {
        metricKey: "trial_conversion_rate",
        label: "Trial Conversion Rate",
        currentValue: trialConversion.value,
        previousValue: trialConversion.previous,
        direction: "down",
      },
      {
        metricKey: "active_users",
        label: "Active Users",
        currentValue: supportingMetrics.active_users.value,
        previousValue: supportingMetrics.active_users.previous,
        direction: computeDirection(
          supportingMetrics.active_users.value,
          supportingMetrics.active_users.previous
        ),
      },
    ];
    return {
      conditionCode: "trial_conversion_drop",
      evidence: {
        conditionCode: "trial_conversion_drop",
        items,
        snapshotComputedAt,
        syncJobId,
      },
    };
  }

  // No condition detected — still produce evidence with summary metrics
  const items: EvidenceItem[] = [
    {
      metricKey: "mrr",
      label: "Monthly Recurring Revenue",
      currentValue: mrr,
      previousValue: prevMrr,
      direction: computeDirection(mrr, prevMrr),
    },
  ];

  return {
    conditionCode: "no_condition_detected",
    evidence: {
      conditionCode: "no_condition_detected",
      items,
      snapshotComputedAt,
      syncJobId,
    },
  };
}

// ---------------------------------------------------------------------------
// Insight generation pipeline
// ---------------------------------------------------------------------------

export interface InsightGenerationDeps {
  explainer: ExplainerFn;
  healthRepo: HealthSnapshotRepository;
  insightRepo: InsightRepository;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface InsightGenerationResult {
  conditionCode: InsightConditionCode;
  error?: string;
  generated: boolean;
  status: string;
}

async function skipInsightGeneration(
  deps: InsightGenerationDeps,
  startupId: string,
  status: import("@shared/startup-insight").InsightGenerationStatus,
  reason: string,
  conditionCode: InsightConditionCode = "no_condition_detected",
  error?: string
): Promise<InsightGenerationResult> {
  await safeUpdateDiagnostics(deps, startupId, status, reason);
  return {
    generated: false,
    conditionCode,
    status,
    error,
  };
}

function parseSupportingMetricsSnapshot(
  snapshot: HealthSnapshotRow
): SupportingMetricsSnapshot {
  const supportingMetrics =
    snapshot.supportingMetrics as SupportingMetricsSnapshot;
  if (typeof supportingMetrics !== "object" || supportingMetrics === null) {
    throw new Error("Supporting metrics is not an object.");
  }

  return supportingMetrics;
}

async function persistNoConditionInsight(
  deps: InsightGenerationDeps,
  startupId: string,
  detection: DetectionResult
): Promise<void> {
  await deps.insightRepo.replaceInsight({
    insightId: randomUUID(),
    startupId,
    conditionCode: detection.conditionCode,
    evidence: detection.evidence,
    explanation: null,
    generationStatus: "skipped_no_condition",
    lastError: null,
    model: null,
    explainerLatencyMs: null,
    generatedAt: new Date(),
  });
}

async function readInsightSnapshotOrSkip(
  deps: InsightGenerationDeps,
  startupId: string,
  logCtx: Record<string, unknown>
): Promise<HealthSnapshotRow | InsightGenerationResult> {
  try {
    const snapshot = await deps.healthRepo.findSnapshot(startupId);
    if (snapshot) {
      return snapshot;
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log.error("failed to read health snapshot", { ...logCtx, error });
    return skipInsightGeneration(
      deps,
      startupId,
      "skipped_stale",
      `Snapshot read failed: ${error}`,
      "no_condition_detected",
      error
    );
  }

  deps.log.warn(
    "no health snapshot exists — skipping insight generation",
    logCtx
  );
  return {
    generated: false,
    conditionCode: "no_condition_detected",
    status: "skipped_stale",
  };
}

async function skipInsightForHealthState(
  deps: InsightGenerationDeps,
  startupId: string,
  healthState: HealthState,
  logCtx: Record<string, unknown>
): Promise<InsightGenerationResult | null> {
  if (healthState === "blocked") {
    deps.log.warn("connector is blocked — skipping insight generation", {
      ...logCtx,
      healthState,
    });
    return skipInsightGeneration(
      deps,
      startupId,
      "skipped_blocked",
      "Connector is blocked."
    );
  }

  if (healthState === "error") {
    deps.log.warn("connector in error state — skipping insight generation", {
      ...logCtx,
      healthState,
    });
    return skipInsightGeneration(
      deps,
      startupId,
      "skipped_stale",
      "Connector in error state."
    );
  }

  return null;
}

async function parseInsightSupportingMetricsOrSkip(
  deps: InsightGenerationDeps,
  startupId: string,
  snapshot: HealthSnapshotRow,
  logCtx: Record<string, unknown>
): Promise<SupportingMetricsSnapshot | InsightGenerationResult> {
  try {
    return parseSupportingMetricsSnapshot(snapshot);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log.error("malformed supporting metrics in snapshot", {
      ...logCtx,
      error,
    });
    return skipInsightGeneration(
      deps,
      startupId,
      "skipped_stale",
      `Malformed metrics: ${error}`,
      "no_condition_detected",
      error
    );
  }
}

async function callExplainerOrSkip(
  deps: InsightGenerationDeps,
  startupId: string,
  detection: DetectionResult,
  logCtx: Record<string, unknown>
): Promise<ExplainerOutput | InsightGenerationResult> {
  try {
    return await deps.explainer({
      conditionCode: detection.conditionCode,
      evidence: detection.evidence,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const retryable =
      (err as Error & { retryable?: boolean }).retryable === true;
    deps.log.error("explainer call failed", { ...logCtx, error, retryable });
    return skipInsightGeneration(
      deps,
      startupId,
      "failed_explainer",
      error,
      detection.conditionCode,
      error
    );
  }
}

async function persistInsightOrSkip(
  deps: InsightGenerationDeps,
  startupId: string,
  detection: DetectionResult,
  explainerOutput: ExplainerOutput,
  generationStart: number,
  logCtx: Record<string, unknown>
): Promise<InsightGenerationResult> {
  const explanation: InsightExplanation = {
    observation: explainerOutput.observation,
    hypothesis: explainerOutput.hypothesis,
    actions: explainerOutput.actions,
    model: explainerOutput.model,
    latencyMs: explainerOutput.latencyMs,
  };

  const explanationError = validateInsightExplanation(explanation);
  if (explanationError !== null) {
    deps.log.error("explainer output validation failed", {
      ...logCtx,
      error: explanationError,
    });
    return skipInsightGeneration(
      deps,
      startupId,
      "failed_explainer",
      `Malformed explainer output: ${explanationError}`,
      detection.conditionCode,
      explanationError
    );
  }

  const generatedAt = new Date();
  const totalLatencyMs = Date.now() - generationStart;
  try {
    await deps.insightRepo.replaceInsight({
      insightId: randomUUID(),
      startupId,
      conditionCode: detection.conditionCode,
      evidence: detection.evidence,
      explanation,
      generationStatus: "success",
      lastError: null,
      model: explainerOutput.model,
      explainerLatencyMs: explainerOutput.latencyMs,
      generatedAt,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log.error("failed to persist insight", { ...logCtx, error });
    await safeUpdateDiagnostics(
      deps,
      startupId,
      "failed_persistence",
      `Persistence failed: ${error}`
    );
    return {
      generated: false,
      conditionCode: detection.conditionCode,
      status: "failed_persistence",
      error,
    };
  }

  deps.log.info("insight generation completed", {
    ...logCtx,
    conditionCode: detection.conditionCode,
    model: explainerOutput.model,
    explainerLatencyMs: explainerOutput.latencyMs,
    totalLatencyMs,
  });

  return {
    generated: true,
    conditionCode: detection.conditionCode,
    status: "success",
  };
}

/**
 * Generate one grounded insight from the latest health snapshot.
 *
 * Pipeline:
 *   1. Read the latest snapshot — skip if none exists or data is stale/blocked.
 *   2. Detect one deterministic condition.
 *   3. If a real condition exists, call the explainer.
 *   4. Validate explainer output — reject malformed responses.
 *   5. Persist the insight with evidence + explanation.
 *   6. On explainer failure, update diagnostics only (preserve-last-good).
 */
export async function generateInsight(
  deps: InsightGenerationDeps,
  startupId: string,
  syncJobId: string
): Promise<InsightGenerationResult> {
  const logCtx = { startupId, syncJobId, component: "insight-generation" };

  deps.log.info("insight generation started", logCtx);
  const generationStart = Date.now();

  const snapshotResult = await readInsightSnapshotOrSkip(
    deps,
    startupId,
    logCtx
  );
  if ("generated" in snapshotResult) {
    return snapshotResult;
  }
  const snapshot = snapshotResult;

  const healthState = snapshot.healthState as HealthState;
  const healthStateSkip = await skipInsightForHealthState(
    deps,
    startupId,
    healthState,
    logCtx
  );
  if (healthStateSkip) {
    return healthStateSkip;
  }

  const supportingMetricsResult = await parseInsightSupportingMetricsOrSkip(
    deps,
    startupId,
    snapshot,
    logCtx
  );
  if ("generated" in supportingMetricsResult) {
    return supportingMetricsResult;
  }
  const supportingMetrics = supportingMetricsResult;

  const detection = detectCondition({
    snapshot,
    supportingMetrics,
    healthState,
  });

  deps.log.info("condition detected", {
    ...logCtx,
    conditionCode: detection.conditionCode,
    evidenceItems: detection.evidence.items.length,
  });

  const evidenceError = validateEvidencePacket(detection.evidence);
  if (evidenceError !== null) {
    deps.log.error("evidence packet validation failed", {
      ...logCtx,
      error: evidenceError,
    });
    return skipInsightGeneration(
      deps,
      startupId,
      "skipped_stale",
      `Invalid evidence: ${evidenceError}`,
      detection.conditionCode,
      evidenceError
    );
  }

  if (detection.conditionCode === "no_condition_detected") {
    deps.log.info(
      "no condition detected — persisting evidence-only insight",
      logCtx
    );
    try {
      await persistNoConditionInsight(deps, startupId, detection);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      deps.log.error("failed to persist no-condition insight", {
        ...logCtx,
        error,
      });
    }
    return {
      generated: false,
      conditionCode: detection.conditionCode,
      status: "skipped_no_condition",
    };
  }

  const explainerResult = await callExplainerOrSkip(
    deps,
    startupId,
    detection,
    logCtx
  );
  if ("generated" in explainerResult) {
    return explainerResult;
  }
  return persistInsightOrSkip(
    deps,
    startupId,
    detection,
    explainerResult,
    generationStart,
    logCtx
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely update diagnostics — failures here must never crash the pipeline.
 */
async function safeUpdateDiagnostics(
  deps: InsightGenerationDeps,
  startupId: string,
  status: import("@shared/startup-insight").InsightGenerationStatus,
  error: string
): Promise<void> {
  try {
    await deps.insightRepo.updateInsightDiagnostics({
      startupId,
      generationStatus: status,
      lastError: error,
      updatedAt: new Date(),
    });
  } catch (err) {
    deps.log.error("failed to update insight diagnostics", {
      startupId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
