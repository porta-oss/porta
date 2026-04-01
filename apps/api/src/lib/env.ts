export type RuntimeMode = 'development' | 'test' | 'production';

export interface ApiEnv {
  nodeEnv: RuntimeMode;
  apiPort: number;
  apiUrl: string;
  webUrl: string;
  databaseUrl: string;
  redisUrl: string;
  betterAuthUrl: string;
  betterAuthSecret: string;
  magicLinkSenderEmail: string;
  googleClientId?: string;
  googleClientSecret?: string;
  authContextTimeoutMs: number;
  databaseConnectTimeoutMs: number;
  databasePoolMax: number;
}

const DEFAULTS = {
  NODE_ENV: 'development',
  API_PORT: '3000',
  API_URL: 'http://localhost:3000',
  WEB_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane',
  REDIS_URL: 'redis://127.0.0.1:6379',
  BETTER_AUTH_URL: 'http://localhost:3000',
  MAGIC_LINK_SENDER_EMAIL: 'dev@founder-control-plane.local',
  AUTH_CONTEXT_TIMEOUT_MS: '2000',
  DATABASE_CONNECT_TIMEOUT_MS: '5000',
  DATABASE_POOL_MAX: '10'
} as const;

const VALID_RUNTIME_MODES = new Set<RuntimeMode>(['development', 'test', 'production']);

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

function parseRuntimeMode(value: string | undefined): RuntimeMode {
  const normalized = (value ?? DEFAULTS.NODE_ENV) as RuntimeMode;

  if (!VALID_RUNTIME_MODES.has(normalized)) {
    throw new Error(`NODE_ENV must be one of: ${Array.from(VALID_RUNTIME_MODES).join(', ')}. Received: ${value}`);
  }

  return normalized;
}

function redactSecret(secret: string | undefined) {
  if (!secret) {
    return '[missing]';
  }

  if (secret.length <= 8) {
    return '[redacted]';
  }

  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function summarizeConfigured(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export function readApiEnv(source: Record<string, string | undefined>, options?: { strict?: boolean }): ApiEnv {
  const strict = options?.strict ?? false;
  const betterAuthSecret = source.BETTER_AUTH_SECRET ?? '';
  const databaseUrl = source.DATABASE_URL ?? DEFAULTS.DATABASE_URL;
  const redisUrl = source.REDIS_URL ?? DEFAULTS.REDIS_URL;
  const googleClientId = source.GOOGLE_CLIENT_ID?.trim() || undefined;
  const googleClientSecret = source.GOOGLE_CLIENT_SECRET?.trim() || undefined;

  if (strict && !source.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in strict mode. Copy .env.example to .env before running runtime-only commands.');
  }

  if (strict && betterAuthSecret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in strict mode.');
  }

  return {
    nodeEnv: parseRuntimeMode(source.NODE_ENV),
    apiPort: parseInteger('API_PORT', source.API_PORT ?? DEFAULTS.API_PORT, 1, 65535),
    apiUrl: parseUrl('API_URL', source.API_URL ?? DEFAULTS.API_URL, ['http:', 'https:']),
    webUrl: parseUrl('WEB_URL', source.WEB_URL ?? DEFAULTS.WEB_URL, ['http:', 'https:']),
    databaseUrl: parseUrl('DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:']),
    redisUrl: parseUrl('REDIS_URL', redisUrl, ['redis:']),
    betterAuthUrl: parseUrl('BETTER_AUTH_URL', source.BETTER_AUTH_URL ?? DEFAULTS.BETTER_AUTH_URL, ['http:', 'https:']),
    betterAuthSecret,
    magicLinkSenderEmail: source.MAGIC_LINK_SENDER_EMAIL ?? DEFAULTS.MAGIC_LINK_SENDER_EMAIL,
    googleClientId,
    googleClientSecret,
    authContextTimeoutMs: parseInteger(
      'AUTH_CONTEXT_TIMEOUT_MS',
      source.AUTH_CONTEXT_TIMEOUT_MS ?? DEFAULTS.AUTH_CONTEXT_TIMEOUT_MS,
      100,
      60000
    ),
    databaseConnectTimeoutMs: parseInteger(
      'DATABASE_CONNECT_TIMEOUT_MS',
      source.DATABASE_CONNECT_TIMEOUT_MS ?? DEFAULTS.DATABASE_CONNECT_TIMEOUT_MS,
      250,
      60000
    ),
    databasePoolMax: parseInteger('DATABASE_POOL_MAX', source.DATABASE_POOL_MAX ?? DEFAULTS.DATABASE_POOL_MAX, 1, 100)
  };
}

export function summarizeAuthProviders(env: ApiEnv) {
  const googleConfigured = Boolean(env.googleClientId && env.googleClientSecret);

  return {
    google: {
      configured: googleConfigured,
      missing: googleConfigured ? [] : ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
    },
    magicLink: {
      configured: true,
      senderEmail: env.magicLinkSenderEmail
    }
  };
}

export function createBootstrapDiagnostics(source: Record<string, string | undefined>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return {
    message,
    nodeEnv: source.NODE_ENV ?? DEFAULTS.NODE_ENV,
    config: {
      apiUrl: source.API_URL ?? DEFAULTS.API_URL,
      webUrl: source.WEB_URL ?? DEFAULTS.WEB_URL,
      betterAuthUrl: source.BETTER_AUTH_URL ?? DEFAULTS.BETTER_AUTH_URL,
      databaseConfigured: summarizeConfigured(source.DATABASE_URL),
      redisConfigured: summarizeConfigured(source.REDIS_URL),
      betterAuthSecret: redactSecret(source.BETTER_AUTH_SECRET),
      googleClientIdConfigured: summarizeConfigured(source.GOOGLE_CLIENT_ID),
      googleClientSecretConfigured: summarizeConfigured(source.GOOGLE_CLIENT_SECRET)
    }
  };
}
