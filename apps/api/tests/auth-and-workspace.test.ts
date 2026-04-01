import { describe, expect, test } from 'bun:test';

import { createApiApp } from '../src/app';
import { readApiEnv } from '../src/lib/env';

describe('auth and workspace bootstrap scaffold', () => {
  test('health endpoint exposes scaffold metadata from the repo root harness', async () => {
    const app = createApiApp();
    const response = await app.handle(new Request('http://localhost/api/health'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe('ok');
    expect(payload.startupRoutes.create.auth).toBe('required');
    expect(payload.config.databaseConfigured).toBe(true);
  });

  test('strict bootstrap env fails fast when DATABASE_URL is missing', () => {
    expect(() =>
      readApiEnv(
        {
          BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef'
        },
        { strict: true }
      )
    ).toThrow('DATABASE_URL is required in strict mode');
  });

  test('strict bootstrap env rejects malformed DATABASE_URL values', () => {
    expect(() =>
      readApiEnv(
        {
          DATABASE_URL: 'mysql://localhost/wrong',
          BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef'
        },
        { strict: true }
      )
    ).toThrow('DATABASE_URL must use one of: postgres:, postgresql:');
  });

  test('strict bootstrap env accepts explicit runtime configuration', () => {
    const env = readApiEnv(
      {
        API_PORT: '3001',
        API_URL: 'http://localhost:3001',
        WEB_URL: 'http://localhost:5173',
        DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane',
        REDIS_URL: 'redis://127.0.0.1:6379',
        BETTER_AUTH_URL: 'http://localhost:3001',
        BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef'
      },
      { strict: true }
    );

    expect(env.apiPort).toBe(3001);
    expect(env.databaseUrl).toContain('postgres://');
  });
});
