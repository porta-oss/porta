// Worker environment configuration.
// Mirrors apps/api/src/lib/env.ts conventions for the subset of vars the worker needs.

export type RuntimeMode = 'development' | 'test' | 'production';

export interface WorkerEnv {
  nodeEnv: RuntimeMode;
  databaseUrl: string;
  redisUrl: string;
  connectorEncryptionKey: string;
  /** Max concurrent sync jobs processed by this worker instance. */
  workerConcurrency: number;
  /** Per-job timeout in milliseconds. */
  jobTimeoutMs: number;
  databaseConnectTimeoutMs: number;
  databasePoolMax: number;
  /** Optional Anthropic API key for insight generation. */
  anthropicApiKey: string | null;
  /** Optional Linear API key for task sync delivery. */
  linearApiKey: string | null;
  /** Optional Linear team ID — target team for created issues. */
  linearTeamId: string | null;
  /** When true, replaces provider sync, explainer, and Linear delivery with deterministic stubs. */
  founderProofMode: boolean;
}

const DEFAULTS = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane',
  REDIS_URL: 'redis://127.0.0.1:6379',
  WORKER_CONCURRENCY: '3',
  JOB_TIMEOUT_MS: '30000',
  DATABASE_CONNECT_TIMEOUT_MS: '5000',
  DATABASE_POOL_MAX: '5',
} as const;

const VALID_RUNTIME_MODES = new Set<RuntimeMode>(['development', 'test', 'production']);

const VALID_FOUNDER_PROOF_VALUES = new Set(['true', 'false', '1', '0', '']);

function parseFounderProofMode(value: string | undefined): boolean {
  const raw = (value ?? '').trim().toLowerCase();

  if (!VALID_FOUNDER_PROOF_VALUES.has(raw)) {
    throw new Error(
      `FOUNDER_PROOF_MODE must be one of: true, false, 1, 0, or absent. Received: "${value}". ` +
      'Set it explicitly or remove it to keep the default (disabled).'
    );
  }

  return raw === 'true' || raw === '1';
}

function parseUrl(name: string, value: string, protocols: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL. Received: ${value}`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use one of: ${protocols.join(', ')}`);
  }
  return value;
}

function parseInteger(name: string, value: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}. Received: ${value}`);
  }
  return parsed;
}

export function readWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const nodeEnv = (source.NODE_ENV ?? DEFAULTS.NODE_ENV) as RuntimeMode;
  if (!VALID_RUNTIME_MODES.has(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of: ${Array.from(VALID_RUNTIME_MODES).join(', ')}. Received: ${source.NODE_ENV}`);
  }

  const connectorEncryptionKey = source.CONNECTOR_ENCRYPTION_KEY?.trim() ?? '';
  if (!connectorEncryptionKey) {
    throw new Error(
      'CONNECTOR_ENCRYPTION_KEY is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (connectorEncryptionKey.length !== 64) {
    throw new Error(`CONNECTOR_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Received length: ${connectorEncryptionKey.length}.`);
  }
  if (!/^[0-9a-fA-F]+$/.test(connectorEncryptionKey)) {
    throw new Error('CONNECTOR_ENCRYPTION_KEY contains non-hex characters.');
  }

  return {
    nodeEnv,
    databaseUrl: parseUrl('DATABASE_URL', source.DATABASE_URL ?? DEFAULTS.DATABASE_URL, ['postgres:', 'postgresql:']),
    redisUrl: parseUrl('REDIS_URL', source.REDIS_URL ?? DEFAULTS.REDIS_URL, ['redis:']),
    connectorEncryptionKey,
    workerConcurrency: parseInteger('WORKER_CONCURRENCY', source.WORKER_CONCURRENCY ?? DEFAULTS.WORKER_CONCURRENCY, 1, 50),
    jobTimeoutMs: parseInteger('JOB_TIMEOUT_MS', source.JOB_TIMEOUT_MS ?? DEFAULTS.JOB_TIMEOUT_MS, 1000, 300_000),
    databaseConnectTimeoutMs: parseInteger(
      'DATABASE_CONNECT_TIMEOUT_MS',
      source.DATABASE_CONNECT_TIMEOUT_MS ?? DEFAULTS.DATABASE_CONNECT_TIMEOUT_MS,
      250,
      60_000
    ),
    databasePoolMax: parseInteger('DATABASE_POOL_MAX', source.DATABASE_POOL_MAX ?? DEFAULTS.DATABASE_POOL_MAX, 1, 100),
    anthropicApiKey: source.ANTHROPIC_API_KEY?.trim() || null,
    linearApiKey: source.LINEAR_API_KEY?.trim() || null,
    linearTeamId: source.LINEAR_TEAM_ID?.trim() || null,
    founderProofMode: parseFounderProofMode(source.FOUNDER_PROOF_MODE),
  };
}
