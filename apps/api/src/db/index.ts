import { readFile } from 'node:fs/promises';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import type { ApiEnv } from '../lib/env';

const { Pool } = pg as unknown as {
  Pool: new (config: {
    connectionString: string;
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    allowExitOnIdle: boolean;
  }) => DatabasePool;
};

const AUTH_MIGRATION_URL = new URL('../../drizzle/0000_s01_auth.sql', import.meta.url);
const STARTUP_MIGRATION_URL = new URL('../../drizzle/0001_s01_startup.sql', import.meta.url);
const AUTH_TABLE_NAMES = ['account', 'session', 'verification', 'member', 'invitation', 'workspace', 'user'] as const;
const APP_TABLE_NAMES = [...AUTH_TABLE_NAMES, 'startup'] as const;

interface DatabasePool {
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
}

export interface ApiDatabase {
  pool: DatabasePool;
  db: ReturnType<typeof drizzle>;
  bootstrap: () => Promise<void>;
  resetAuthTables: () => Promise<void>;
  close: () => Promise<void>;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase(pool: DatabasePool, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await pool.query('select 1');
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
  const migrationSql = await readFile(migrationUrl, 'utf8');
  await pool.query(migrationSql);
}

async function listExistingTables(pool: DatabasePool, tables: readonly string[]) {
  const result = (await pool.query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${tables.map((table) => `'${table}'`).join(', ')})`
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

  const existingStartupTables = await listExistingTables(pool, ['startup']);

  if (!existingStartupTables.has('startup')) {
    await applyMigration(pool, STARTUP_MIGRATION_URL);
  }
}

export function createApiDatabase(env: ApiEnv): ApiDatabase {
  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: env.databasePoolMax,
    connectionTimeoutMillis: env.databaseConnectTimeoutMs,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: env.nodeEnv === 'test'
  });
  const db = drizzle(pool);

  let bootstrapped = false;

  return {
    pool,
    db,
    async bootstrap() {
      if (bootstrapped) {
        return;
      }

      await waitForDatabase(pool, env.databaseConnectTimeoutMs);
      await ensureExpectedSchemaState(pool);
      bootstrapped = true;
    },
    async resetAuthTables() {
      await pool.query(`TRUNCATE TABLE ${APP_TABLE_NAMES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`);
    },
    async close() {
      await pool.end();
    }
  };
}
