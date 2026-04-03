import { type ApiApp, createApiApp } from "../../src/app";

export const API_TEST_ENV = {
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/porta",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  MAGIC_LINK_SENDER_EMAIL: "dev@porta.local",
  CONNECTOR_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  AUTH_CONTEXT_TIMEOUT_MS: "2000",
  DATABASE_CONNECT_TIMEOUT_MS: "5000",
  DATABASE_POOL_MAX: "5",
} as const;

export async function createTestApiApp(
  options?: Parameters<typeof createApiApp>[1]
) {
  return createApiApp(API_TEST_ENV, options);
}

export async function closeTestApiApp(app: ApiApp | undefined) {
  await app?.runtime.db.close();
}

export function requireValue<T>(
  value: T | null | undefined,
  message: string
): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}
