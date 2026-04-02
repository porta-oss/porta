// Task-sync processor tests.
// Tests the task-sync processor with in-memory stubs for the repository and Linear client.
// No Redis, Postgres, or Linear API required — the processor is pure logic over injected interfaces.

import { describe, test, expect, beforeEach } from 'bun:test';

import { createTaskSyncProcessor } from '../src/processors/task-sync';
import type {
  TaskSyncJobPayload,
  TaskSyncProcessorDeps,
  LinearIssueResult,
  LinearCreateIssueFn,
} from '../src/processors/task-sync';
import type { InternalTaskRepository, InternalTaskRow } from '../src/repository';

// ---------- helpers ----------

function makeTaskRow(overrides?: Partial<InternalTaskRow>): InternalTaskRow {
  return {
    id: 'task-1',
    startupId: 'startup-1',
    title: 'Investigate MRR drop',
    description: 'The MRR dropped 15% — investigate churn patterns and create retention experiments.',
    linkedMetricKeys: ['mrr', 'churn_rate'],
    syncStatus: 'not_synced',
    linearIssueId: null,
    sourceInsightId: 'insight-1',
    sourceActionIndex: 0,
    ...overrides,
  };
}

function makePayload(overrides?: Partial<TaskSyncJobPayload>): TaskSyncJobPayload {
  return {
    taskId: 'task-1',
    ...overrides,
  };
}

/** Minimal BullMQ Job-like object for testing. */
function makeJob(data: TaskSyncJobPayload, attemptsMade = 0) {
  return {
    id: `bullmq-task-sync-${data.taskId}`,
    data,
    attemptsMade,
    name: 'task-sync',
  } as any;
}

/** Stub Linear client that returns success by default. */
function createStubLinearClient(
  result: LinearIssueResult = {
    success: true,
    issueId: 'LIN-123',
    issueUrl: 'https://linear.app/team/LIN-123',
  },
): LinearCreateIssueFn & { calls: Array<{ task: InternalTaskRow; teamId: string }> } {
  const calls: Array<{ task: InternalTaskRow; teamId: string }> = [];
  const fn = async (task: InternalTaskRow, teamId: string) => {
    calls.push({ task, teamId });
    return result;
  };
  fn.calls = calls;
  return fn;
}

/** Stub Linear client that throws. */
function createThrowingLinearClient(error = 'Network failure'): LinearCreateIssueFn {
  return async () => {
    throw new Error(error);
  };
}

/** In-memory task repository stub. */
function createStubTaskRepo(
  tasks: Map<string, InternalTaskRow> = new Map(),
): InternalTaskRepository & {
  tasks: Map<string, InternalTaskRow>;
  syncingCalls: Array<{ taskId: string; attemptAt: Date }>;
  syncedCalls: Array<{ taskId: string; linearIssueId: string; linearIssueUrl: string; syncedAt: Date }>;
  failedCalls: Array<{ taskId: string; error: string; attemptAt: Date }>;
} {
  const syncingCalls: Array<{ taskId: string; attemptAt: Date }> = [];
  const syncedCalls: Array<{ taskId: string; linearIssueId: string; linearIssueUrl: string; syncedAt: Date }> = [];
  const failedCalls: Array<{ taskId: string; error: string; attemptAt: Date }> = [];

  return {
    tasks,
    syncingCalls,
    syncedCalls,
    failedCalls,

    async findTask(taskId: string) {
      return tasks.get(taskId);
    },

    async markTaskSyncing(taskId: string, attemptAt: Date) {
      syncingCalls.push({ taskId, attemptAt });
      const task = tasks.get(taskId);
      if (task) {
        task.syncStatus = 'syncing';
      }
    },

    async markTaskSynced(input) {
      syncedCalls.push(input);
      const task = tasks.get(input.taskId);
      if (task) {
        task.syncStatus = 'synced';
        task.linearIssueId = input.linearIssueId;
      }
    },

    async markTaskSyncFailed(input) {
      failedCalls.push(input);
      const task = tasks.get(input.taskId);
      if (task) {
        task.syncStatus = 'failed';
      }
    },
  };
}

const TEAM_ID = 'team-abc-123';

/** Silent logger for tests. */
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Capturing logger to assert log calls. */
function createCapturingLog() {
  const entries: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
  return {
    entries,
    info(msg: string, meta?: Record<string, unknown>) {
      entries.push({ level: 'info', msg, meta });
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      entries.push({ level: 'warn', msg, meta });
    },
    error(msg: string, meta?: Record<string, unknown>) {
      entries.push({ level: 'error', msg, meta });
    },
  };
}

// ---------- tests ----------

describe('task-sync processor', () => {
  let taskRepo: ReturnType<typeof createStubTaskRepo>;
  let linearClient: ReturnType<typeof createStubLinearClient>;
  let log: ReturnType<typeof createCapturingLog>;

  beforeEach(() => {
    taskRepo = createStubTaskRepo(new Map([['task-1', makeTaskRow()]]));
    linearClient = createStubLinearClient();
    log = createCapturingLog();
  });

  function makeDeps(overrides?: Partial<TaskSyncProcessorDeps>): TaskSyncProcessorDeps {
    return {
      taskRepo,
      createLinearIssue: linearClient,
      linearTeamId: TEAM_ID,
      log,
      ...overrides,
    };
  }

  describe('successful sync', () => {
    test('creates Linear issue and marks task synced', async () => {
      const processor = createTaskSyncProcessor(makeDeps());
      const job = makeJob(makePayload());

      await processor(job);

      // Linear client was called with correct data
      expect(linearClient.calls).toHaveLength(1);
      expect(linearClient.calls[0]!.task.id).toBe('task-1');
      expect(linearClient.calls[0]!.teamId).toBe(TEAM_ID);

      // Task was marked syncing then synced
      expect(taskRepo.syncingCalls).toHaveLength(1);
      expect(taskRepo.syncedCalls).toHaveLength(1);
      expect(taskRepo.syncedCalls[0]!.linearIssueId).toBe('LIN-123');
      expect(taskRepo.syncedCalls[0]!.linearIssueUrl).toBe('https://linear.app/team/LIN-123');

      // No failures
      expect(taskRepo.failedCalls).toHaveLength(0);
    });

    test('logs success with issue ID and duration', async () => {
      const processor = createTaskSyncProcessor(makeDeps());
      await processor(makeJob(makePayload()));

      const syncedLog = log.entries.find(e => e.msg === 'task synced to Linear');
      expect(syncedLog).toBeDefined();
      expect(syncedLog!.meta!.linearIssueId).toBe('LIN-123');
      expect(typeof syncedLog!.meta!.durationMs).toBe('number');
    });

    test('passes task title and description to Linear', async () => {
      const processor = createTaskSyncProcessor(makeDeps());
      await processor(makeJob(makePayload()));

      expect(linearClient.calls[0]!.task.title).toBe('Investigate MRR drop');
      expect(linearClient.calls[0]!.task.description).toContain('MRR dropped 15%');
    });
  });

  describe('idempotent handling of already-synced tasks', () => {
    test('skips sync when task is already synced', async () => {
      taskRepo.tasks.set('task-1', makeTaskRow({
        syncStatus: 'synced',
        linearIssueId: 'LIN-EXISTING',
      }));

      const processor = createTaskSyncProcessor(makeDeps());
      await processor(makeJob(makePayload()));

      // Linear was never called
      expect(linearClient.calls).toHaveLength(0);

      // No status transitions
      expect(taskRepo.syncingCalls).toHaveLength(0);
      expect(taskRepo.syncedCalls).toHaveLength(0);
      expect(taskRepo.failedCalls).toHaveLength(0);

      // Logged the skip
      const skipLog = log.entries.find(e => e.msg === 'task already synced — skipping');
      expect(skipLog).toBeDefined();
      expect(skipLog!.meta!.linearIssueId).toBe('LIN-EXISTING');
    });
  });

  describe('task not found', () => {
    test('completes without throwing when task does not exist', async () => {
      const processor = createTaskSyncProcessor(makeDeps());
      const job = makeJob({ taskId: 'nonexistent' });

      // Should not throw — BullMQ marks as completed
      await processor(job);

      expect(linearClient.calls).toHaveLength(0);
      const errorLog = log.entries.find(e => e.msg === 'task not found — may have been deleted');
      expect(errorLog).toBeDefined();
    });
  });

  describe('missing taskId in payload', () => {
    test('completes without throwing when taskId is empty', async () => {
      const processor = createTaskSyncProcessor(makeDeps());
      const job = makeJob({ taskId: '' });

      await processor(job);

      expect(linearClient.calls).toHaveLength(0);
      const errorLog = log.entries.find(e => e.msg === 'task sync job missing taskId — dropping');
      expect(errorLog).toBeDefined();
    });
  });

  describe('retryable Linear failures', () => {
    test('throws on rate limit (429) so BullMQ retries', async () => {
      const failingClient = createStubLinearClient({
        success: false,
        error: 'Linear API rate limit exceeded (429). Retry later.',
        retryable: true,
      });

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: failingClient,
      }));

      const job = makeJob(makePayload());
      await expect(processor(job)).rejects.toThrow('rate limit');

      // Task was marked syncing then failed
      expect(taskRepo.syncingCalls).toHaveLength(1);
      expect(taskRepo.failedCalls).toHaveLength(1);
      expect(taskRepo.failedCalls[0]!.error).toContain('429');
      expect(taskRepo.syncedCalls).toHaveLength(0);
    });

    test('throws on server error (5xx) so BullMQ retries', async () => {
      const failingClient = createStubLinearClient({
        success: false,
        error: 'Linear API server error (500).',
        retryable: true,
      });

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: failingClient,
      }));

      await expect(processor(makeJob(makePayload()))).rejects.toThrow('500');

      expect(taskRepo.failedCalls).toHaveLength(1);
    });

    test('throws on network timeout so BullMQ retries', async () => {
      const failingClient = createStubLinearClient({
        success: false,
        error: 'Linear API request failed: timeout',
        retryable: true,
      });

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: failingClient,
      }));

      await expect(processor(makeJob(makePayload()))).rejects.toThrow('timeout');
    });
  });

  describe('non-retryable Linear failures', () => {
    test('does not throw on 401 — records failure and completes', async () => {
      const failingClient = createStubLinearClient({
        success: false,
        error: 'Linear API authentication failed (401). Check LINEAR_API_KEY.',
        retryable: false,
      });

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: failingClient,
      }));

      // Should NOT throw — BullMQ marks as completed, we recorded the failure
      await processor(makeJob(makePayload()));

      expect(taskRepo.failedCalls).toHaveLength(1);
      expect(taskRepo.failedCalls[0]!.error).toContain('401');
      expect(taskRepo.syncedCalls).toHaveLength(0);
    });

    test('does not throw on malformed response — records failure', async () => {
      const failingClient = createStubLinearClient({
        success: false,
        error: 'Linear issue creation response missing issue id/url.',
        retryable: false,
      });

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: failingClient,
      }));

      await processor(makeJob(makePayload()));

      expect(taskRepo.failedCalls).toHaveLength(1);
      expect(taskRepo.failedCalls[0]!.error).toContain('missing issue id/url');
    });

    test('does not throw on GraphQL errors — records failure', async () => {
      const failingClient = createStubLinearClient({
        success: false,
        error: 'Linear GraphQL errors: Invalid team ID',
        retryable: false,
      });

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: failingClient,
      }));

      await processor(makeJob(makePayload()));

      expect(taskRepo.failedCalls).toHaveLength(1);
      expect(taskRepo.failedCalls[0]!.error).toContain('Invalid team ID');
    });
  });

  describe('retry after failed attempt', () => {
    test('retries a previously failed task successfully', async () => {
      // Start with a failed task
      taskRepo.tasks.set('task-1', makeTaskRow({
        syncStatus: 'failed',
      }));

      const processor = createTaskSyncProcessor(makeDeps());
      const job = makeJob(makePayload(), 1); // second attempt

      await processor(job);

      // Should have synced successfully
      expect(taskRepo.syncingCalls).toHaveLength(1);
      expect(taskRepo.syncedCalls).toHaveLength(1);
      expect(taskRepo.syncedCalls[0]!.linearIssueId).toBe('LIN-123');
    });
  });

  describe('Linear client throws unexpectedly', () => {
    test('propagates the error for BullMQ retry when Linear client throws', async () => {
      const throwingClient = createThrowingLinearClient('Connection reset');

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: throwingClient,
      }));

      // The processor itself does not catch thrown errors from createLinearIssue —
      // BullMQ will see the unhandled error and retry
      await expect(processor(makeJob(makePayload()))).rejects.toThrow('Connection reset');

      // Task was marked syncing before the throw
      expect(taskRepo.syncingCalls).toHaveLength(1);
    });
  });

  describe('observability', () => {
    test('logs job started, syncing transitions, and final outcome', async () => {
      const processor = createTaskSyncProcessor(makeDeps());
      await processor(makeJob(makePayload()));

      const startLog = log.entries.find(e => e.msg === 'task sync job started');
      expect(startLog).toBeDefined();
      expect(startLog!.meta!.taskId).toBe('task-1');
      expect(startLog!.meta!.attempt).toBe(1);

      const syncedLog = log.entries.find(e => e.msg === 'task synced to Linear');
      expect(syncedLog).toBeDefined();
    });

    test('logs retryable failure with error and duration', async () => {
      const failingClient = createStubLinearClient({
        success: false,
        error: 'Linear API rate limit exceeded (429). Retry later.',
        retryable: true,
      });

      const processor = createTaskSyncProcessor(makeDeps({
        createLinearIssue: failingClient,
      }));

      try {
        await processor(makeJob(makePayload()));
      } catch {
        // Expected throw
      }

      const warnLog = log.entries.find(e => e.msg === 'task sync failed (retryable)');
      expect(warnLog).toBeDefined();
      expect(warnLog!.meta!.error).toContain('429');
      expect(typeof warnLog!.meta!.durationMs).toBe('number');
    });
  });
});
