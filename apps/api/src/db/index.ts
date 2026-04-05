import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { ApiEnv } from "../lib/env";

const { Pool } = pg as unknown as {
  Pool: new (config: {
    connectionString: string;
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    allowExitOnIdle: boolean;
  }) => DatabasePool;
};

const AUTH_MIGRATION_URL = new URL(
  "../../drizzle/0000_s01_auth.sql",
  import.meta.url
);
const APP_MIGRATION_URL = new URL(
  "../../drizzle/0001_orange_phalanx.sql",
  import.meta.url
);
const AUTH_TABLE_NAMES = [
  "account",
  "session",
  "verification",
  "member",
  "invitation",
  "workspace",
  "user",
] as const;
const NON_AUTH_TABLE_NAMES = [
  "startup",
  "connector",
  "sync_job",
  "health_snapshot",
  "health_funnel_stage",
  "health_snapshot_history",
  "startup_insight",
  "internal_task",
  "custom_metric",
  "alert_rule",
  "alert",
  "streak",
  "event_log",
  "telegram_config",
  "webhook_config",
  "api_key",
] as const;
const APP_TABLE_NAMES = [...AUTH_TABLE_NAMES, ...NON_AUTH_TABLE_NAMES] as const;

type AppTableName = (typeof APP_TABLE_NAMES)[number];

interface DatabasePool {
  end: () => Promise<void>;
  query: (sql: string) => Promise<unknown>;
}

interface QueryResult<Row extends Record<string, unknown>> {
  rows?: Row[];
}

interface DatabaseError {
  code?: string;
}

export interface SchemaDiagnostics {
  appTablesReady: boolean;
  authTablesReady: boolean;
  tables: Record<AppTableName, boolean>;
}

export interface ApiDatabase {
  bootstrap: () => Promise<void>;
  close: () => Promise<void>;
  db: ReturnType<typeof drizzle>;
  getSchemaDiagnostics: () => SchemaDiagnostics;
  pool: DatabasePool;
  resetAuthTables: () => Promise<void>;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createEmptySchemaDiagnostics(): SchemaDiagnostics {
  return {
    authTablesReady: false,
    appTablesReady: false,
    tables: Object.fromEntries(
      APP_TABLE_NAMES.map((table) => [table, false])
    ) as Record<AppTableName, boolean>,
  };
}

function createSchemaDiagnostics(
  existingTables: Set<string>
): SchemaDiagnostics {
  return {
    authTablesReady: AUTH_TABLE_NAMES.every((table) =>
      existingTables.has(table)
    ),
    appTablesReady: NON_AUTH_TABLE_NAMES.every((table) =>
      existingTables.has(table)
    ),
    tables: Object.fromEntries(
      APP_TABLE_NAMES.map((table) => [table, existingTables.has(table)])
    ) as Record<AppTableName, boolean>,
  };
}

async function waitForDatabase(pool: DatabasePool, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new Error(
    `Database bootstrap timed out after ${timeoutMs}ms while waiting for Postgres. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

async function applyMigration(pool: DatabasePool, migrationUrl: URL) {
  const migrationSql = await readFile(migrationUrl, "utf8");
  await pool.query(migrationSql);
}

function escapeSqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function escapeSqlIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseDatabaseUrlParts(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\/+/, "");

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.searchParams.delete("schema");

  return {
    adminConnectionString: adminUrl.toString(),
    databaseName,
  };
}

async function ensureTestDatabaseExists(env: ApiEnv) {
  if (env.nodeEnv !== "test") {
    return;
  }

  const { adminConnectionString, databaseName } = parseDatabaseUrlParts(
    env.databaseUrl
  );
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < env.databaseConnectTimeoutMs) {
    const adminPool = new Pool({
      connectionString: adminConnectionString,
      max: 1,
      connectionTimeoutMillis: env.databaseConnectTimeoutMs,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true,
    });

    try {
      const result = (await adminPool.query(
        `select datname from pg_database where datname = ${escapeSqlLiteral(databaseName)}`
      )) as QueryResult<{ datname: string }>;

      if ((result.rows ?? []).length === 0) {
        try {
          await adminPool.query(
            `create database ${escapeSqlIdentifier(databaseName)}`
          );
        } catch (error) {
          const databaseError = error as DatabaseError;

          if (databaseError.code !== "42P04") {
            throw error;
          }
        }
      }

      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    } finally {
      await adminPool.end();
    }
  }

  throw new Error(
    `Database bootstrap timed out after ${env.databaseConnectTimeoutMs}ms while ensuring test database "${databaseName}" exists. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

async function listExistingTables(
  pool: DatabasePool,
  tables: readonly string[]
) {
  const result = (await pool.query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${tables.map((table) => `'${table}'`).join(", ")})`
  )) as {
    rows?: Array<{ table_name: string }>;
  };

  return new Set((result.rows ?? []).map((row) => row.table_name));
}

async function ensureExpectedSchemaState(pool: DatabasePool) {
  const existingAuthTables = await listExistingTables(pool, AUTH_TABLE_NAMES);

  if (existingAuthTables.size === 0) {
    await applyMigration(pool, AUTH_MIGRATION_URL);
  } else if (existingAuthTables.size !== AUTH_TABLE_NAMES.length) {
    throw new Error(
      `Unexpected partial auth schema detected. Expected ${AUTH_TABLE_NAMES.length} auth tables, found ${existingAuthTables.size}. Reset the database or repair the migration state before booting the API.`
    );
  }

  const existingAppTables = await listExistingTables(
    pool,
    NON_AUTH_TABLE_NAMES
  );

  if (existingAppTables.size === 0) {
    await applyMigration(pool, APP_MIGRATION_URL);
  } else if (existingAppTables.size !== NON_AUTH_TABLE_NAMES.length) {
    throw new Error(
      `Unexpected partial app schema detected. Expected ${NON_AUTH_TABLE_NAMES.length} app tables, found ${existingAppTables.size}. Reset the database or repair the migration state before booting the API.`
    );
  }

  return listExistingTables(pool, APP_TABLE_NAMES);
}

export function createApiDatabase(env: ApiEnv): ApiDatabase {
  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: env.databasePoolMax,
    connectionTimeoutMillis: env.databaseConnectTimeoutMs,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: env.nodeEnv === "test",
  });
  const db = drizzle(pool);

  let bootstrapped = false;
  let schemaDiagnostics = createEmptySchemaDiagnostics();

  return {
    pool,
    db,
    async bootstrap() {
      if (bootstrapped) {
        return;
      }

      try {
        await ensureTestDatabaseExists(env);
      } catch (error) {
        const { databaseName } = parseDatabaseUrlParts(env.databaseUrl);
        throw new Error(
          `Test database bootstrap failed for database "${databaseName}": ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await waitForDatabase(pool, env.databaseConnectTimeoutMs);
      const existingTables = await ensureExpectedSchemaState(pool);
      schemaDiagnostics = createSchemaDiagnostics(existingTables);
      bootstrapped = true;
    },
    async resetAuthTables() {
      await pool.query(
        `TRUNCATE TABLE ${APP_TABLE_NAMES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`
      );
    },
    getSchemaDiagnostics() {
      return schemaDiagnostics;
    },
    async close() {
      await pool.end();
    },
  };
}
