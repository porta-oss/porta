export interface ApiEnv {
  apiPort: number;
  apiUrl: string;
  webUrl: string;
  databaseUrl: string;
  redisUrl: string;
  betterAuthUrl: string;
  betterAuthSecret: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

const DEFAULTS = {
  API_PORT: '3000',
  API_URL: 'http://localhost:3000',
  WEB_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane',
  REDIS_URL: 'redis://127.0.0.1:6379',
  BETTER_AUTH_URL: 'http://localhost:3000'
} as const;

function parseUrl(name: string, value: string, protocols: string[]) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${name} must be a valid URL. Received: ${value}`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use one of: ${protocols.join(', ')}`);
  }

  return value;
}

function parsePort(value: string) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be an integer between 1 and 65535. Received: ${value}`);
  }

  return port;
}

export function readApiEnv(source: Record<string, string | undefined>, options?: { strict?: boolean }): ApiEnv {
  const strict = options?.strict ?? false;
  const databaseUrl = source.DATABASE_URL ?? DEFAULTS.DATABASE_URL;
  const redisUrl = source.REDIS_URL ?? DEFAULTS.REDIS_URL;
  const betterAuthSecret = source.BETTER_AUTH_SECRET ?? '';

  if (strict && !source.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in strict mode. Copy .env.example to .env before running runtime-only commands.');
  }

  if (strict && betterAuthSecret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in strict mode.');
  }

  return {
    apiPort: parsePort(source.API_PORT ?? DEFAULTS.API_PORT),
    apiUrl: parseUrl('API_URL', source.API_URL ?? DEFAULTS.API_URL, ['http:', 'https:']),
    webUrl: parseUrl('WEB_URL', source.WEB_URL ?? DEFAULTS.WEB_URL, ['http:', 'https:']),
    databaseUrl: parseUrl('DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:']),
    redisUrl: parseUrl('REDIS_URL', redisUrl, ['redis:']),
    betterAuthUrl: parseUrl('BETTER_AUTH_URL', source.BETTER_AUTH_URL ?? DEFAULTS.BETTER_AUTH_URL, ['http:', 'https:']),
    betterAuthSecret,
    googleClientId: source.GOOGLE_CLIENT_ID,
    googleClientSecret: source.GOOGLE_CLIENT_SECRET
  };
}
