import { type PortaEdition, parseEdition } from "@shared/edition";

export type RuntimeMode = "development" | "test" | "production";

export interface ApiEnv {
  apiHost: string;
  apiPort: number;
  apiUrl: string;
  authContextTimeoutMs: number;
  betterAuthSecret: string;
  betterAuthUrl: string;
  connectorEncryptionKey: string;
  databaseConnectTimeoutMs: number;
  databasePoolMax: number;
  databaseUrl: string;
  edition: PortaEdition;
  founderProofMode: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  magicLinkSenderEmail: string;
  nodeEnv: RuntimeMode;
  redisUrl: string;
  webUrl: string;
}

const DEFAULTS = {
  NODE_ENV: "development",
  API_HOST: "0.0.0.0",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/porta",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_URL: "http://localhost:3000",
  MAGIC_LINK_SENDER_EMAIL: "dev@porta.local",
  AUTH_CONTEXT_TIMEOUT_MS: "2000",
  DATABASE_CONNECT_TIMEOUT_MS: "5000",
  DATABASE_POOL_MAX: "10",
} as const;

const VALID_RUNTIME_MODES = new Set<RuntimeMode>([
  "development",
  "test",
  "production",
]);

function parseUrl(name: string, value: string, protocols: string[]) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL. Received: ${value}`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use one of: ${protocols.join(", ")}`);
  }

  return value;
}

function parseInteger(name: string, value: string, min: number, max: number) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `${name} must be an integer between ${min} and ${max}. Received: ${value}`
    );
  }

  return parsed;
}

function parseRuntimeMode(value: string | undefined): RuntimeMode {
  const normalized = (value ?? DEFAULTS.NODE_ENV) as RuntimeMode;

  if (!VALID_RUNTIME_MODES.has(normalized)) {
    throw new Error(
      `NODE_ENV must be one of: ${Array.from(VALID_RUNTIME_MODES).join(", ")}. Received: ${value}`
    );
  }

  return normalized;
}

const VALID_FOUNDER_PROOF_VALUES = new Set(["true", "false", "1", "0", ""]);
const CONNECTOR_ENCRYPTION_KEY_PATTERN = /^[0-9a-fA-F]+$/;

function readOptionalTrimmed(
  source: Record<string, string | undefined>,
  key: string
): string | undefined {
  return source[key]?.trim() || undefined;
}

function validateStrictApiEnv(
  source: Record<string, string | undefined>,
  values: { betterAuthSecret: string; connectorEncryptionKey: string }
): void {
  if (!source.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required in strict mode. Copy .env.example to .env before running runtime-only commands."
    );
  }

  if (values.betterAuthSecret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters in strict mode."
    );
  }

  if (!values.connectorEncryptionKey) {
    throw new Error(
      "CONNECTOR_ENCRYPTION_KEY is required in strict mode. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
}

function validateConnectorEncryptionKey(connectorEncryptionKey: string): void {
  if (!connectorEncryptionKey) {
    return;
  }

  if (connectorEncryptionKey.length !== 64) {
    throw new Error(
      `CONNECTOR_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Received length: ${connectorEncryptionKey.length}.`
    );
  }

  if (!CONNECTOR_ENCRYPTION_KEY_PATTERN.test(connectorEncryptionKey)) {
    throw new Error("CONNECTOR_ENCRYPTION_KEY contains non-hex characters.");
  }
}

function parseFounderProofMode(value: string | undefined): boolean {
  const raw = (value ?? "").trim().toLowerCase();

  if (!VALID_FOUNDER_PROOF_VALUES.has(raw)) {
    throw new Error(
      `FOUNDER_PROOF_MODE must be one of: true, false, 1, 0, or absent. Received: "${value}". ` +
        "Set it explicitly or remove it to keep the default (disabled)."
    );
  }

  return raw === "true" || raw === "1";
}

function redactSecret(secret: string | undefined) {
  if (!secret) {
    return "[missing]";
  }

  if (secret.length <= 8) {
    return "[redacted]";
  }

  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function summarizeConfigured(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function resolveApiPort(source: Record<string, string | undefined>): string {
  return source.API_PORT ?? source.PORT ?? DEFAULTS.API_PORT;
}

export function readApiEnv(
  source: Record<string, string | undefined>,
  options?: { strict?: boolean }
): ApiEnv {
  const strict = options?.strict ?? false;
  const betterAuthSecret = source.BETTER_AUTH_SECRET ?? "";
  const databaseUrl = source.DATABASE_URL ?? DEFAULTS.DATABASE_URL;
  const redisUrl = source.REDIS_URL ?? DEFAULTS.REDIS_URL;
  const googleClientId = readOptionalTrimmed(source, "GOOGLE_CLIENT_ID");
  const googleClientSecret = readOptionalTrimmed(
    source,
    "GOOGLE_CLIENT_SECRET"
  );
  const connectorEncryptionKey = source.CONNECTOR_ENCRYPTION_KEY?.trim() ?? "";

  if (strict) {
    validateStrictApiEnv(source, {
      betterAuthSecret,
      connectorEncryptionKey,
    });
  }

  validateConnectorEncryptionKey(connectorEncryptionKey);

  return {
    edition: parseEdition(source.PORTA_EDITION),
    nodeEnv: parseRuntimeMode(source.NODE_ENV),
    apiHost: (source.API_HOST ?? DEFAULTS.API_HOST).trim() || DEFAULTS.API_HOST,
    apiPort: parseInteger("API_PORT", resolveApiPort(source), 1, 65_535),
    apiUrl: parseUrl("API_URL", source.API_URL ?? DEFAULTS.API_URL, [
      "http:",
      "https:",
    ]),
    webUrl: parseUrl("WEB_URL", source.WEB_URL ?? DEFAULTS.WEB_URL, [
      "http:",
      "https:",
    ]),
    databaseUrl: parseUrl("DATABASE_URL", databaseUrl, [
      "postgres:",
      "postgresql:",
    ]),
    redisUrl: parseUrl("REDIS_URL", redisUrl, ["redis:"]),
    betterAuthUrl: parseUrl(
      "BETTER_AUTH_URL",
      source.BETTER_AUTH_URL ?? DEFAULTS.BETTER_AUTH_URL,
      ["http:", "https:"]
    ),
    betterAuthSecret,
    connectorEncryptionKey,
    magicLinkSenderEmail:
      source.MAGIC_LINK_SENDER_EMAIL ?? DEFAULTS.MAGIC_LINK_SENDER_EMAIL,
    googleClientId,
    googleClientSecret,
    authContextTimeoutMs: parseInteger(
      "AUTH_CONTEXT_TIMEOUT_MS",
      source.AUTH_CONTEXT_TIMEOUT_MS ?? DEFAULTS.AUTH_CONTEXT_TIMEOUT_MS,
      100,
      60_000
    ),
    databaseConnectTimeoutMs: parseInteger(
      "DATABASE_CONNECT_TIMEOUT_MS",
      source.DATABASE_CONNECT_TIMEOUT_MS ??
        DEFAULTS.DATABASE_CONNECT_TIMEOUT_MS,
      250,
      60_000
    ),
    databasePoolMax: parseInteger(
      "DATABASE_POOL_MAX",
      source.DATABASE_POOL_MAX ?? DEFAULTS.DATABASE_POOL_MAX,
      1,
      100
    ),
    founderProofMode: parseFounderProofMode(source.FOUNDER_PROOF_MODE),
  };
}

export function summarizeAuthProviders(env: ApiEnv) {
  const googleConfigured = Boolean(
    env.googleClientId && env.googleClientSecret
  );

  return {
    google: {
      configured: googleConfigured,
      missing: googleConfigured
        ? []
        : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
    magicLink: {
      configured: true,
      senderEmail: env.magicLinkSenderEmail,
    },
  };
}

export function createBootstrapDiagnostics(
  source: Record<string, string | undefined>,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);

  return {
    message,
    edition: source.PORTA_EDITION ?? "community",
    nodeEnv: source.NODE_ENV ?? DEFAULTS.NODE_ENV,
    founderProofMode: source.FOUNDER_PROOF_MODE ?? "absent",
    config: {
      apiUrl: source.API_URL ?? DEFAULTS.API_URL,
      webUrl: source.WEB_URL ?? DEFAULTS.WEB_URL,
      betterAuthUrl: source.BETTER_AUTH_URL ?? DEFAULTS.BETTER_AUTH_URL,
      databaseConfigured: summarizeConfigured(source.DATABASE_URL),
      redisConfigured: summarizeConfigured(source.REDIS_URL),
      betterAuthSecret: redactSecret(source.BETTER_AUTH_SECRET),
      connectorEncryptionKeyConfigured: summarizeConfigured(
        source.CONNECTOR_ENCRYPTION_KEY
      ),
      googleClientIdConfigured: summarizeConfigured(source.GOOGLE_CLIENT_ID),
      googleClientSecretConfigured: summarizeConfigured(
        source.GOOGLE_CLIENT_SECRET
      ),
    },
  };
}
