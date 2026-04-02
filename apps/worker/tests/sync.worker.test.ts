// Worker sync processor tests.
// Tests the sync processor with in-memory stubs for the repository and provider router.
// No Redis or Postgres required — the processor is pure logic over injected interfaces.

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { SyncJobPayload } from "@shared/connectors";
import { encryptConnectorConfig, parseEncryptionKey } from "@shared/crypto";
import type {
  ConnectorRow,
  SyncProcessorDeps,
  SyncRepository,
} from "../src/processors/sync";
import { createSyncProcessor } from "../src/processors/sync";
import {
  createStubProviderRouter,
  createThrowingProviderRouter,
} from "../src/providers";

// ---------- helpers ----------

const TEST_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const keyBuffer = parseEncryptionKey(TEST_ENCRYPTION_KEY);

function makeConnectorRow(overrides?: Partial<ConnectorRow>): ConnectorRow {
  const config = JSON.stringify({
    apiKey: "phc_test",
    projectId: "123",
    host: "https://app.posthog.com",
  });
  const blob = encryptConnectorConfig(config, keyBuffer);
  return {
    id: "conn-1",
    provider: "posthog",
    encryptedConfig: blob.ciphertext,
    encryptionIv: blob.iv,
    encryptionAuthTag: blob.authTag,
    ...overrides,
  };
}

function makePayload(overrides?: Partial<SyncJobPayload>): SyncJobPayload {
  return {
    connectorId: "conn-1",
    startupId: "startup-1",
    provider: "posthog",
    trigger: "initial",
    syncJobId: "sjob-1",
    ...overrides,
  };
}

/** Minimal BullMQ Job-like object for testing. */
function makeJob(data: SyncJobPayload, attemptsMade = 0) {
  return {
    id: `bullmq-${data.syncJobId}`,
    data,
    attemptsMade,
    name: "connector-sync",
  } as any;
}

/** In-memory repository that records all mutations for assertion. */
function createInMemoryRepo(
  connectorRow?: ConnectorRow | undefined
): SyncRepository & {
  mutations: Array<{ op: string; args: unknown[] }>;
} {
  const mutations: Array<{ op: string; args: unknown[] }> = [];
  return {
    mutations,
    async findConnector(connectorId: string) {
      mutations.push({ op: "findConnector", args: [connectorId] });
      return connectorRow;
    },
    async markSyncJobRunning(syncJobId, startedAt, attempt) {
      mutations.push({
        op: "markSyncJobRunning",
        args: [syncJobId, startedAt, attempt],
      });
    },
    async markSyncJobCompleted(
      syncJobId,
      connectorId,
      completedAt,
      durationMs
    ) {
      mutations.push({
        op: "markSyncJobCompleted",
        args: [syncJobId, connectorId, completedAt, durationMs],
      });
    },
    async markSyncJobFailed(
      syncJobId,
      connectorId,
      error,
      completedAt,
      durationMs
    ) {
      mutations.push({
        op: "markSyncJobFailed",
        args: [syncJobId, connectorId, error, completedAt, durationMs],
      });
    },
  };
}

function silentLog() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeDeps(
  overrides?: Partial<SyncProcessorDeps> & {
    repo?: ReturnType<typeof createInMemoryRepo>;
  }
): SyncProcessorDeps & { repo: ReturnType<typeof createInMemoryRepo> } {
  const repo = overrides?.repo ?? createInMemoryRepo(makeConnectorRow());
  return {
    repo,
    encryptionKey: TEST_ENCRYPTION_KEY,
    validateProvider: createStubProviderRouter({ valid: true }),
    log: silentLog(),
    ...overrides,
  };
}

// ---------- tests ----------

describe("sync processor", () => {
  describe("happy path", () => {
    test("marks sync job running → completed and connector → connected", async () => {
      const deps = makeDeps();
      const processor = createSyncProcessor(deps);
      const job = makeJob(makePayload());

      await processor(job);

      const ops = deps.repo.mutations.map((m) => m.op);
      expect(ops).toContain("markSyncJobRunning");
      expect(ops).toContain("markSyncJobCompleted");
      expect(ops).not.toContain("markSyncJobFailed");
    });

    test("passes decrypted config to provider validator", async () => {
      const providerRouter = createStubProviderRouter({ valid: true });
      const deps = makeDeps({ validateProvider: providerRouter });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      expect(providerRouter.calls.length).toBe(1);
      expect(providerRouter.calls[0]?.provider).toBe("posthog");
      const parsed = JSON.parse(providerRouter.calls[0]?.configJson);
      expect(parsed.apiKey).toBe("phc_test");
    });

    test("records correct attempt number from job.attemptsMade", async () => {
      const deps = makeDeps();
      const processor = createSyncProcessor(deps);

      // Simulate second attempt (attemptsMade=1 → attempt=2)
      await processor(makeJob(makePayload(), 1));

      const runningOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobRunning"
      );
      expect(runningOp).toBeDefined();
      expect(runningOp?.args[2]).toBe(2); // attempt
    });
  });

  describe("connector not found", () => {
    test("marks job failed and throws when connector row is missing", async () => {
      const repo = createInMemoryRepo(undefined); // no connector
      const deps = makeDeps({ repo });
      const processor = createSyncProcessor(deps);

      await expect(processor(makeJob(makePayload()))).rejects.toThrow(
        "not found"
      );

      const failOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobFailed"
      );
      expect(failOp).toBeDefined();
      expect(failOp?.args[2]).toContain("not found");
    });
  });

  describe("decryption failure", () => {
    test("marks job failed when encrypted config is corrupted", async () => {
      const badRow = makeConnectorRow({ encryptedConfig: "deadbeef" });
      const repo = createInMemoryRepo(badRow);
      const deps = makeDeps({ repo });
      const processor = createSyncProcessor(deps);

      await expect(processor(makeJob(makePayload()))).rejects.toThrow(
        "Decryption failed"
      );

      const failOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobFailed"
      );
      expect(failOp).toBeDefined();
      expect(failOp?.args[2] as string).toContain("Decryption failed");
    });
  });

  describe("provider validation failure", () => {
    test("marks job failed (non-retryable) without throwing", async () => {
      const deps = makeDeps({
        validateProvider: createStubProviderRouter({
          valid: false,
          error: "Invalid API key",
        }),
      });
      const processor = createSyncProcessor(deps);

      // Non-retryable failures should NOT throw (BullMQ won't retry)
      await processor(makeJob(makePayload()));

      const failOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobFailed"
      );
      expect(failOp).toBeDefined();
      expect(failOp?.args[2]).toContain("Invalid API key");
    });

    test("marks job failed and throws when retryable", async () => {
      const deps = makeDeps({
        validateProvider: createStubProviderRouter({
          valid: false,
          error: "Server error",
          retryable: true,
        }),
      });
      const processor = createSyncProcessor(deps);

      await expect(processor(makeJob(makePayload()))).rejects.toThrow(
        "Server error"
      );

      const failOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobFailed"
      );
      expect(failOp).toBeDefined();
    });
  });

  describe("provider adapter throws", () => {
    test("catches thrown errors and marks job failed", async () => {
      const deps = makeDeps({
        validateProvider: createThrowingProviderRouter("Connection refused"),
      });
      const processor = createSyncProcessor(deps);

      await expect(processor(makeJob(makePayload()))).rejects.toThrow(
        "Connection refused"
      );

      const failOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobFailed"
      );
      expect(failOp).toBeDefined();
      expect(failOp?.args[2] as string).toContain("Connection refused");
    });
  });

  describe("durable failure state", () => {
    test("failed job records error text, timestamps, and duration", async () => {
      const deps = makeDeps({
        validateProvider: createStubProviderRouter({
          valid: false,
          error: "Auth failed",
        }),
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      const failOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobFailed"
      );
      expect(failOp).toBeDefined();
      const [syncJobId, connectorId, error, completedAt, durationMs] =
        failOp?.args as [string, string, string, Date, number];
      expect(syncJobId).toBe("sjob-1");
      expect(connectorId).toBe("conn-1");
      expect(error).toContain("Auth failed");
      expect(completedAt).toBeInstanceOf(Date);
      expect(typeof durationMs).toBe("number");
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    test("completed job records timestamps and duration", async () => {
      const deps = makeDeps();
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      const completeOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobCompleted"
      );
      expect(completeOp).toBeDefined();
      const [syncJobId, connectorId, completedAt, durationMs] =
        completeOp?.args as [string, string, Date, number];
      expect(syncJobId).toBe("sjob-1");
      expect(connectorId).toBe("conn-1");
      expect(completedAt).toBeInstanceOf(Date);
      expect(typeof durationMs).toBe("number");
    });
  });

  describe("malformed payload handling", () => {
    test("missing connector ID leads to connector-not-found failure", async () => {
      const repo = createInMemoryRepo(undefined);
      const deps = makeDeps({ repo });
      const processor = createSyncProcessor(deps);
      const payload = makePayload({ connectorId: "nonexistent" });

      await expect(processor(makeJob(payload))).rejects.toThrow("not found");
    });
  });
});

describe("provider router", () => {
  test("stub router records calls and returns configured result", async () => {
    const router = createStubProviderRouter({ valid: true });

    const result = await router("posthog", '{"apiKey":"test"}');

    expect(result.valid).toBe(true);
    expect(router.calls.length).toBe(1);
    expect(router.calls[0]?.provider).toBe("posthog");
  });

  test("throwing router propagates error", async () => {
    const router = createThrowingProviderRouter("boom");

    await expect(router("stripe", "{}")).rejects.toThrow("boom");
  });
});
