import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type {
  EvidencePacket,
  InsightAction,
  InsightExplanation,
} from "@shared/startup-insight";
import {
  computeDirection,
  INSIGHT_CONDITION_CODES,
  INSIGHT_CONDITION_LABELS,
  INSIGHT_GENERATION_STATUSES,
  isInsightConditionCode,
  isInsightGenerationStatus,
  MAX_INSIGHT_ACTIONS,
  MIN_INSIGHT_ACTIONS,
  validateEvidencePacket,
  validateInsightActions,
  validateInsightExplanation,
} from "@shared/startup-insight";
import {
  createInsightRepository,
  type InsightRepository,
  type ReplaceInsightInput,
} from "../../worker/src/repository";
import type { ApiApp } from "../src/app";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

let app: ApiApp | undefined;
let insightRepo: InsightRepository;

function getApp() {
  return requireValue(app, "Expected API test app to be initialized.");
}

beforeAll(async () => {
  app = await createTestApiApp();
  const testApp = getApp();

  const dbHandle = {
    execute: async (query: unknown) => {
      return (
        testApp.runtime.db.db as unknown as {
          execute: (q: unknown) => Promise<{ rows: unknown[] }>;
        }
      ).execute(query);
    },
  };
  insightRepo = createInsightRepository(dbHandle);
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(path: string) {
  return getApp().handle(new Request(`http://localhost${path}`));
}

/** Insert a workspace + startup directly for testing. */
async function seedStartup(): Promise<{
  workspaceId: string;
  startupId: string;
}> {
  const testApp = getApp();
  const workspaceId = randomUUID();
  const startupId = randomUUID();
  const userId = randomUUID();

  await testApp.runtime.db.pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ('${userId}', 'Test User', 'test-${userId}@example.com', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await testApp.runtime.db.pool.query(
    `INSERT INTO "workspace" (id, name, slug, created_at)
     VALUES ('${workspaceId}', 'Test WS', 'test-ws-${workspaceId.slice(0, 8)}', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await testApp.runtime.db.pool.query(
    `INSERT INTO "member" (id, organization_id, user_id, role, created_at)
     VALUES ('${randomUUID()}', '${workspaceId}', '${userId}', 'owner', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await testApp.runtime.db.pool.query(
    `INSERT INTO "startup" (id, workspace_id, name, type, stage, timezone, currency, created_at, updated_at)
     VALUES ('${startupId}', '${workspaceId}', 'Test Startup', 'b2b_saas', 'mvp', 'UTC', 'USD', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );

  return { workspaceId, startupId };
}

function makeEvidencePacket(
  overrides?: Partial<EvidencePacket>
): EvidencePacket {
  return {
    conditionCode: "mrr_declining",
    items: [
      {
        metricKey: "mrr",
        label: "Monthly Recurring Revenue",
        currentValue: 10_000,
        previousValue: 12_500,
        direction: "down",
      },
    ],
    snapshotComputedAt: new Date().toISOString(),
    syncJobId: randomUUID(),
    ...overrides,
  };
}

function makeExplanation(
  overrides?: Partial<InsightExplanation>
): InsightExplanation {
  return {
    observation:
      "MRR has declined 20% from $12,500 to $10,000 over the last period.",
    hypothesis:
      "Recent churn in the mid-market segment may be driving the revenue decrease.",
    actions: [
      {
        label: "Review churn cohorts",
        rationale: "Identify which customer segments are churning fastest.",
      },
      {
        label: "Check pricing alignment",
        rationale:
          "Verify pricing matches perceived value for churning customers.",
      },
    ],
    model: "claude-sonnet-4-20250514",
    latencyMs: 1200,
    ...overrides,
  };
}

function makeInsightInput(
  startupId: string,
  overrides?: Partial<ReplaceInsightInput>
): ReplaceInsightInput {
  return {
    insightId: randomUUID(),
    startupId,
    conditionCode: "mrr_declining",
    evidence: makeEvidencePacket(),
    explanation: makeExplanation(),
    generationStatus: "success",
    lastError: null,
    model: "claude-sonnet-4-20250514",
    explainerLatencyMs: 1200,
    generatedAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// 1. Shared Contract — Condition Code Guards
// ============================================================================

describe("insight contract — condition code guards", () => {
  test("isInsightConditionCode accepts known values and rejects unknown", () => {
    for (const code of INSIGHT_CONDITION_CODES) {
      expect(isInsightConditionCode(code)).toBe(true);
    }
    expect(isInsightConditionCode("unknown_condition")).toBe(false);
    expect(isInsightConditionCode("")).toBe(false);
    expect(isInsightConditionCode("MRR_DECLINING")).toBe(false); // case-sensitive
  });

  test("isInsightGenerationStatus accepts known values and rejects unknown", () => {
    for (const status of INSIGHT_GENERATION_STATUSES) {
      expect(isInsightGenerationStatus(status)).toBe(true);
    }
    expect(isInsightGenerationStatus("pending")).toBe(false);
    expect(isInsightGenerationStatus("")).toBe(false);
  });

  test("condition labels cover all codes", () => {
    for (const code of INSIGHT_CONDITION_CODES) {
      expect(typeof INSIGHT_CONDITION_LABELS[code]).toBe("string");
      expect(INSIGHT_CONDITION_LABELS[code].length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// 2. Shared Contract — Action Count Enforcement
// ============================================================================

describe("insight contract — action count enforcement", () => {
  test("validateInsightActions accepts 1 action", () => {
    const actions: InsightAction[] = [
      { label: "Do something", rationale: "Because it helps." },
    ];
    expect(validateInsightActions(actions)).toBeNull();
  });

  test("validateInsightActions accepts 2 actions", () => {
    const actions: InsightAction[] = [
      { label: "First", rationale: "Reason one." },
      { label: "Second", rationale: "Reason two." },
    ];
    expect(validateInsightActions(actions)).toBeNull();
  });

  test("validateInsightActions accepts 3 actions (max)", () => {
    const actions: InsightAction[] = [
      { label: "A", rationale: "R1." },
      { label: "B", rationale: "R2." },
      { label: "C", rationale: "R3." },
    ];
    expect(validateInsightActions(actions)).toBeNull();
  });

  test("validateInsightActions rejects 0 actions", () => {
    const err = validateInsightActions([]);
    expect(err).toContain(`${MIN_INSIGHT_ACTIONS}`);
    expect(err).toContain("0");
  });

  test("validateInsightActions rejects 4+ actions", () => {
    const actions: InsightAction[] = [
      { label: "A", rationale: "R1." },
      { label: "B", rationale: "R2." },
      { label: "C", rationale: "R3." },
      { label: "D", rationale: "R4." },
    ];
    const err = validateInsightActions(actions);
    expect(err).toContain(`${MAX_INSIGHT_ACTIONS}`);
    expect(err).toContain("4");
  });

  test("validateInsightActions rejects non-array", () => {
    expect(validateInsightActions("not-an-array")).toContain(
      "must be an array"
    );
    expect(validateInsightActions(null)).toContain("must be an array");
  });

  test("validateInsightActions rejects action with empty label", () => {
    const actions = [{ label: "", rationale: "Something." }];
    expect(validateInsightActions(actions)).toContain("non-empty label");
  });

  test("validateInsightActions rejects action with empty rationale", () => {
    const actions = [{ label: "Do it", rationale: "" }];
    expect(validateInsightActions(actions)).toContain("non-empty rationale");
  });

  test("validateInsightActions rejects action that is not an object", () => {
    const actions = ["not-an-object"];
    expect(validateInsightActions(actions)).toContain("non-null object");
  });
});

// ============================================================================
// 3. Shared Contract — Evidence Packet Validation
// ============================================================================

describe("insight contract — evidence packet validation", () => {
  test("validateEvidencePacket accepts a valid packet", () => {
    const packet = makeEvidencePacket();
    expect(validateEvidencePacket(packet)).toBeNull();
  });

  test("validateEvidencePacket rejects unknown condition code", () => {
    const packet = { ...makeEvidencePacket(), conditionCode: "unknown_code" };
    expect(validateEvidencePacket(packet)).toContain("Invalid condition code");
  });

  test("validateEvidencePacket rejects non-object", () => {
    expect(validateEvidencePacket(null)).toContain("non-null object");
    expect(validateEvidencePacket("string")).toContain("non-null object");
  });

  test("validateEvidencePacket rejects non-array items", () => {
    const packet = { ...makeEvidencePacket(), items: "not-an-array" };
    expect(validateEvidencePacket(packet)).toContain("must be an array");
  });

  test("validateEvidencePacket rejects item with non-finite currentValue", () => {
    const packet = makeEvidencePacket();
    const firstItem = requireValue(packet.items[0], "Expected evidence item.");
    packet.items[0] = { ...firstItem, currentValue: Number.NaN };
    expect(validateEvidencePacket(packet)).toContain("finite currentValue");
  });

  test("validateEvidencePacket rejects item with invalid direction", () => {
    const packet = makeEvidencePacket();
    (packet.items[0] as unknown as Record<string, unknown>).direction =
      "sideways";
    expect(validateEvidencePacket(packet)).toContain("direction");
  });

  test("validateEvidencePacket rejects empty snapshotComputedAt", () => {
    const packet = { ...makeEvidencePacket(), snapshotComputedAt: "" };
    expect(validateEvidencePacket(packet)).toContain(
      "non-empty snapshotComputedAt"
    );
  });
});

// ============================================================================
// 4. Shared Contract — Explanation Validation
// ============================================================================

describe("insight contract — explanation validation", () => {
  test("validateInsightExplanation accepts a valid explanation", () => {
    const explanation = makeExplanation();
    expect(validateInsightExplanation(explanation)).toBeNull();
  });

  test("validateInsightExplanation rejects non-object", () => {
    expect(validateInsightExplanation(null)).toContain("non-null object");
  });

  test("validateInsightExplanation rejects empty observation", () => {
    const explanation = { ...makeExplanation(), observation: "" };
    expect(validateInsightExplanation(explanation)).toContain(
      "non-empty observation"
    );
  });

  test("validateInsightExplanation rejects empty hypothesis", () => {
    const explanation = { ...makeExplanation(), hypothesis: "" };
    expect(validateInsightExplanation(explanation)).toContain(
      "non-empty hypothesis"
    );
  });

  test("validateInsightExplanation rejects empty model", () => {
    const explanation = { ...makeExplanation(), model: "" };
    expect(validateInsightExplanation(explanation)).toContain(
      "non-empty model"
    );
  });

  test("validateInsightExplanation rejects negative latencyMs", () => {
    const explanation = { ...makeExplanation(), latencyMs: -1 };
    expect(validateInsightExplanation(explanation)).toContain("non-negative");
  });

  test("validateInsightExplanation rejects NaN latencyMs", () => {
    const explanation = { ...makeExplanation(), latencyMs: Number.NaN };
    expect(validateInsightExplanation(explanation)).toContain(
      "non-negative finite"
    );
  });

  test("validateInsightExplanation cascades action validation", () => {
    const explanation = makeExplanation({ actions: [] });
    const err = validateInsightExplanation(explanation);
    expect(err).toContain(`${MIN_INSIGHT_ACTIONS}`);
  });
});

// ============================================================================
// 5. Shared Contract — Direction Computation
// ============================================================================

describe("insight contract — direction computation", () => {
  test('computeDirection returns "down" when current < previous', () => {
    expect(computeDirection(10, 20)).toBe("down");
  });

  test('computeDirection returns "up" when current > previous', () => {
    expect(computeDirection(20, 10)).toBe("up");
  });

  test('computeDirection returns "flat" when current === previous', () => {
    expect(computeDirection(10, 10)).toBe("flat");
  });

  test('computeDirection returns "flat" when previous is null', () => {
    expect(computeDirection(10, null)).toBe("flat");
  });
});

// ============================================================================
// 6. Migration & Bootstrap — Insight Table
// ============================================================================

describe("migration and bootstrap — insight table", () => {
  test("startup_insight table exists after bootstrap", async () => {
    const result = (await getApp().runtime.db.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'startup_insight'`
    )) as { rows?: Array<{ table_name: string }> };

    const tableNames = new Set((result.rows ?? []).map((r) => r.table_name));
    expect(tableNames.has("startup_insight")).toBe(true);
  });

  test("health endpoint reports startup-insight table readiness", async () => {
    const res = await send("/api/health");
    const body = await parseJson(res);

    expect(res.status).toBe(200);
    expect(body.startupInsight).toEqual({ tablesReady: true });

    const database = body.database as { tables: string[] };
    expect(database.tables).toContain("startup_insight");
  });

  test("checkInsightTableExists reports table ready", async () => {
    const ready = await insightRepo.checkInsightTableExists();
    expect(ready).toBe(true);
  });

  test("unique constraint on startup_id prevents duplicate insight rows", async () => {
    const { startupId } = await seedStartup();

    // Write first insight
    const first = makeInsightInput(startupId);
    await insightRepo.replaceInsight(first);

    // Direct insert bypassing delete should fail
    const secondId = randomUUID();
    try {
      await getApp().runtime.db.pool.query(
        `INSERT INTO startup_insight (id, startup_id, condition_code, evidence, generation_status, generated_at, updated_at)
         VALUES ('${secondId}', '${startupId}', 'mrr_declining', '{}', 'success', NOW(), NOW())`
      );
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const pgCode =
        typeof (error as Record<string, unknown>).code === "string"
          ? (error as Record<string, unknown>).code
          : undefined;
      expect(pgCode).toBe("23505");
    }
  });
});

// ============================================================================
// 7. Insight Persistence — Write / Read / Replace
// ============================================================================

describe("insight persistence — write / read / replace", () => {
  test("first insight for a startup can be written and read back", async () => {
    const { startupId } = await seedStartup();
    const input = makeInsightInput(startupId);

    await insightRepo.replaceInsight(input);

    const row = await insightRepo.findInsight(startupId);
    expect(row).toBeDefined();
    expect(row?.startupId).toBe(startupId);
    expect(row?.conditionCode).toBe("mrr_declining");
    expect(row?.generationStatus).toBe("success");
    expect(row?.lastError).toBeNull();
    expect(row?.model).toBe("claude-sonnet-4-20250514");
    expect(row?.explainerLatencyMs).toBe(1200);
    expect(row?.evidence).toBeTruthy();
    expect(row?.explanation).toBeTruthy();
  });

  test("replacing an existing insight atomically swaps all data", async () => {
    const { startupId } = await seedStartup();

    // Write initial insight
    const first = makeInsightInput(startupId, {
      conditionCode: "mrr_declining",
    });
    await insightRepo.replaceInsight(first);

    // Replace with a churn_spike insight
    const second = makeInsightInput(startupId, {
      conditionCode: "churn_spike",
      evidence: makeEvidencePacket({ conditionCode: "churn_spike" }),
    });
    await insightRepo.replaceInsight(second);

    const row = await insightRepo.findInsight(startupId);
    expect(row).toBeDefined();
    expect(row?.id).toBe(second.insightId);
    expect(row?.id).not.toBe(first.insightId);
    expect(row?.conditionCode).toBe("churn_spike");
  });

  test("reading a startup with no insight returns undefined", async () => {
    const { startupId } = await seedStartup();
    const row = await insightRepo.findInsight(startupId);
    expect(row).toBeUndefined();
  });

  test("insight with null explanation is valid (skipped generation)", async () => {
    const { startupId } = await seedStartup();
    const input = makeInsightInput(startupId, {
      explanation: null,
      generationStatus: "skipped_blocked",
      model: null,
      explainerLatencyMs: null,
      lastError: null,
    });

    await insightRepo.replaceInsight(input);

    const row = await insightRepo.findInsight(startupId);
    expect(row).toBeDefined();
    expect(row?.explanation).toBeNull();
    expect(row?.generationStatus).toBe("skipped_blocked");
    expect(row?.model).toBeNull();
    expect(row?.explainerLatencyMs).toBeNull();
  });

  test("insight with lastError preserves error message", async () => {
    const { startupId } = await seedStartup();
    const input = makeInsightInput(startupId, {
      explanation: null,
      generationStatus: "failed_explainer",
      lastError: "Anthropic API returned 500",
      model: null,
      explainerLatencyMs: null,
    });

    await insightRepo.replaceInsight(input);

    const row = await insightRepo.findInsight(startupId);
    expect(row?.lastError).toBe("Anthropic API returned 500");
    expect(row?.generationStatus).toBe("failed_explainer");
  });
});

// ============================================================================
// 8. Insight Persistence — Preserve-Last-Good Semantics
// ============================================================================

describe("insight persistence — preserve-last-good semantics", () => {
  test("updateInsightDiagnostics updates status and error without changing evidence/explanation", async () => {
    const { startupId } = await seedStartup();

    // Write a good insight
    const input = makeInsightInput(startupId, {
      generationStatus: "success",
      lastError: null,
    });
    await insightRepo.replaceInsight(input);

    // Simulate a failed re-generation: only update diagnostics
    const updated = await insightRepo.updateInsightDiagnostics({
      startupId,
      generationStatus: "failed_explainer",
      lastError: "Explainer timed out after 30s",
      updatedAt: new Date(),
    });
    expect(updated).toBe(true);

    // Verify the evidence and explanation are preserved
    const row = await insightRepo.findInsight(startupId);
    expect(row).toBeDefined();
    expect(row?.conditionCode).toBe("mrr_declining"); // Unchanged
    expect(row?.explanation).toBeTruthy(); // Preserved
    expect(row?.generationStatus).toBe("failed_explainer"); // Updated
    expect(row?.lastError).toBe("Explainer timed out after 30s"); // Updated
  });

  test("updateInsightDiagnostics returns false when no insight exists", async () => {
    const { startupId } = await seedStartup();

    const updated = await insightRepo.updateInsightDiagnostics({
      startupId,
      generationStatus: "failed_explainer",
      lastError: "No insight to update",
      updatedAt: new Date(),
    });
    expect(updated).toBe(false);
  });

  test("good insight survives a failed diagnostics update on a different startup", async () => {
    const { startupId: startupA } = await seedStartup();
    const { startupId: startupB } = await seedStartup();

    // Write a good insight for startup A
    await insightRepo.replaceInsight(makeInsightInput(startupA));

    // Update diagnostics for startup B (which has no insight)
    const updated = await insightRepo.updateInsightDiagnostics({
      startupId: startupB,
      generationStatus: "failed_explainer",
      lastError: "Error on B",
      updatedAt: new Date(),
    });
    expect(updated).toBe(false);

    // Startup A's insight is untouched
    const rowA = await insightRepo.findInsight(startupA);
    expect(rowA).toBeDefined();
    expect(rowA?.generationStatus).toBe("success");
  });
});

// ============================================================================
// 9. Negative Tests — Malformed Inputs
// ============================================================================

describe("negative tests — malformed insight inputs", () => {
  test("isInsightConditionCode rejects camelCase, uppercase, and typos", () => {
    expect(isInsightConditionCode("mrrDeclining")).toBe(false);
    expect(isInsightConditionCode("MRR_DECLINING")).toBe(false);
    expect(isInsightConditionCode("mrr-declining")).toBe(false);
    expect(isInsightConditionCode("churn_spke")).toBe(false);
  });

  test("validateEvidencePacket rejects item with non-string metricKey", () => {
    const packet = makeEvidencePacket();
    (packet.items[0] as unknown as Record<string, unknown>).metricKey = 42;
    expect(validateEvidencePacket(packet)).toContain("non-empty metricKey");
  });

  test("validateEvidencePacket rejects item with empty label", () => {
    const packet = makeEvidencePacket();
    const firstItem = requireValue(packet.items[0], "Expected evidence item.");
    packet.items[0] = { ...firstItem, label: "" };
    expect(validateEvidencePacket(packet)).toContain("non-empty label");
  });

  test("validateEvidencePacket rejects item with invalid previousValue", () => {
    const packet = makeEvidencePacket();
    (packet.items[0] as unknown as Record<string, unknown>).previousValue =
      "not-a-number";
    expect(validateEvidencePacket(packet)).toContain("finite number or null");
  });

  test("validateInsightExplanation rejects missing actions array", () => {
    const explanation = { ...makeExplanation() } as Record<string, unknown>;
    explanation.actions = undefined;
    expect(validateInsightExplanation(explanation)).toContain(
      "must be an array"
    );
  });

  test("validateInsightActions rejects action with whitespace-only label", () => {
    const actions = [{ label: "   ", rationale: "Something." }];
    expect(validateInsightActions(actions)).toContain("non-empty label");
  });

  test("validateInsightActions rejects action with whitespace-only rationale", () => {
    const actions = [{ label: "Do it", rationale: "   " }];
    expect(validateInsightActions(actions)).toContain("non-empty rationale");
  });
});
