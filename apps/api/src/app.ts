import { Elysia } from 'elysia';

import { readApiEnv } from './lib/env';
import { createStartupRouteContract } from './routes/startup';

export function createApiApp(envSource: Record<string, string | undefined> = process.env) {
  const env = readApiEnv(envSource);
  const startupRoutes = createStartupRouteContract();

  return new Elysia({ prefix: '/api' })
    .get('/health', () => ({
      status: 'ok' as const,
      service: 'api',
      startupRoutes,
      config: {
        apiUrl: env.apiUrl,
        webUrl: env.webUrl,
        databaseConfigured: Boolean(env.databaseUrl),
        redisConfigured: Boolean(env.redisUrl)
      }
    }))
    .get('/auth/session', () => ({
      authenticated: false,
      message: 'Auth bootstrap pending Better Auth wiring.'
    }));
}
