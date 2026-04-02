import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { convertSetCookieToCookie } from 'better-auth/test';

import { createApiApp, type ApiApp } from '../src/app';
import { readApiEnv } from '../src/lib/env';

const TEST_ENV = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  API_URL: 'http://localhost:3000',
  WEB_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane',
  REDIS_URL: 'redis://127.0.0.1:6379',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  MAGIC_LINK_SENDER_EMAIL: 'dev@founder-control-plane.local',
  CONNECTOR_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  AUTH_CONTEXT_TIMEOUT_MS: '2000',
  DATABASE_CONNECT_TIMEOUT_MS: '5000',
  DATABASE_POOL_MAX: '5'
} as const;

let app: ApiApp;

beforeAll(async () => {
  app = await createApiApp(TEST_ENV);
});

beforeEach(async () => {
  app.runtime.auth.resetMagicLinks();
  await app.runtime.db.resetAuthTables();
});

afterAll(async () => {
  await app.runtime.db.close();
});

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(path: string, init?: { method?: string; body?: unknown; cookie?: string }) {
  const headers = new Headers();

  if (init?.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  if (init?.cookie) {
    headers.set('cookie', init.cookie);
  }

  return app.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    })
  );
}

async function createAuthenticatedSession(email = 'founder@example.com') {
  const signInResponse = await send('/api/auth/sign-in/magic-link', {
    method: 'POST',
    body: {
      email,
      name: 'Founder'
    }
  });

  expect(signInResponse.status).toBe(200);
  const magicLink = app.runtime.auth.getLatestMagicLink(email);
  expect(magicLink).toBeDefined();

  const verifyResponse = await app.handle(new Request(magicLink!.url));
  const cookie = convertSetCookieToCookie(verifyResponse.headers).get('cookie') ?? '';

  expect(cookie.length).toBeGreaterThan(0);

  return {
    cookie,
    verifyResponse,
    magicLink: magicLink!
  };
}

describe('auth and workspace integration', () => {
  test('health exposes auth mount status and google provider wiring, and auth mount serves social sign-in', async () => {
    const healthResponse = await send('/api/health');
    const healthPayload = await parseJson(healthResponse);

    expect(healthResponse.status).toBe(200);
    expect(healthPayload.status).toBe('ok');
    expect(healthPayload.auth).toMatchObject({
      mounted: true,
      mountPath: '/api/auth',
      magicLinkTransport: 'dev-inbox',
      observability: {
        devMagicLinkEndpoint: '/api/dev/magic-links/latest'
      }
    });
    expect((healthPayload.auth as { providers: { google: { configured: boolean } } }).providers.google.configured).toBe(true);

    const socialResponse = await send('/api/auth/sign-in/social', {
      method: 'POST',
      body: {
        provider: 'google',
        disableRedirect: true,
        callbackURL: 'http://localhost:5173/auth/callback'
      }
    });
    const socialPayload = await parseJson(socialResponse);

    expect(socialResponse.status).toBe(200);
    expect(socialPayload.redirect).toBe(false);
    expect(String(socialPayload.url)).toContain('accounts.google.com');
  });

  test('strict env parsing fails fast for missing Better Auth secret', () => {
    expect(() =>
      readApiEnv(
        {
          DATABASE_URL: TEST_ENV.DATABASE_URL,
          BETTER_AUTH_URL: TEST_ENV.BETTER_AUTH_URL,
          API_URL: TEST_ENV.API_URL,
          WEB_URL: TEST_ENV.WEB_URL,
          BETTER_AUTH_SECRET: 'too-short'
        },
        { strict: true }
      )
    ).toThrow('BETTER_AUTH_SECRET must be at least 32 characters in strict mode.');
  });

  test('magic-link sign-in establishes a session and shows no active workspace for a first user', async () => {
    const { cookie, verifyResponse } = await createAuthenticatedSession();

    expect([200, 302]).toContain(verifyResponse.status);

    const sessionResponse = await send('/api/auth/session', { cookie });
    const sessionPayload = await parseJson(sessionResponse);

    expect(sessionResponse.status).toBe(200);
    expect(sessionPayload.authenticated).toBe(true);
    expect((sessionPayload.session as { activeWorkspaceId: string | null }).activeWorkspaceId).toBeNull();

    const activeWorkspaceResponse = await send('/api/workspaces/active', { cookie });
    const activeWorkspacePayload = await parseJson(activeWorkspaceResponse);

    expect(activeWorkspaceResponse.status).toBe(200);
    expect(activeWorkspacePayload.workspace).toBeNull();
    expect(activeWorkspacePayload.member).toBeNull();
  });

  test('exposes the latest queued dev magic link so local verification can complete the browser flow', async () => {
    const signInResponse = await send('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: {
        email: 'observer@example.com',
        name: 'Observer'
      }
    });

    expect(signInResponse.status).toBe(200);

    const latestMagicLinkResponse = await send('/api/dev/magic-links/latest?email=observer@example.com');
    const latestMagicLinkPayload = await parseJson(latestMagicLinkResponse);

    expect(latestMagicLinkResponse.status).toBe(200);
    expect(latestMagicLinkPayload).toMatchObject({
      transport: 'dev-inbox',
      count: 1,
      delivery: {
        email: 'observer@example.com'
      }
    });
    expect(String((latestMagicLinkPayload.delivery as { url: string }).url)).toContain('/api/auth/magic-link/verify');
  });

  test('rejects unauthenticated or invalid-cookie workspace access', async () => {
    const createWithoutAuth = await send('/api/workspaces', {
      method: 'POST',
      body: {
        name: 'Acme'
      }
    });
    const createWithoutAuthPayload = await parseJson(createWithoutAuth);

    expect(createWithoutAuth.status).toBe(401);
    expect(createWithoutAuthPayload.error).toMatchObject({ code: 'AUTH_REQUIRED' });

    const invalidCookieSession = await send('/api/auth/session', {
      cookie: 'better-auth.session_token=invalid-cookie'
    });
    const invalidCookiePayload = await parseJson(invalidCookieSession);

    expect(invalidCookieSession.status).toBe(200);
    expect(invalidCookiePayload.authenticated).toBe(false);
  });

  test('creates workspaces through the protected API, rejects blank and duplicate names, and can switch the active workspace', async () => {
    const { cookie } = await createAuthenticatedSession('workspace-owner@example.com');

    const blankWorkspaceResponse = await send('/api/workspaces', {
      method: 'POST',
      cookie,
      body: {
        name: '   '
      }
    });
    const blankWorkspacePayload = await parseJson(blankWorkspaceResponse);

    expect(blankWorkspaceResponse.status).toBe(400);
    expect(blankWorkspacePayload.error).toMatchObject({ code: 'WORKSPACE_NAME_REQUIRED' });

    const firstWorkspaceResponse = await send('/api/workspaces', {
      method: 'POST',
      cookie,
      body: {
        name: 'Acme Labs'
      }
    });
    const firstWorkspacePayload = await parseJson(firstWorkspaceResponse);
    const firstWorkspace = firstWorkspacePayload.workspace as { id: string; slug: string; name: string };

    expect(firstWorkspaceResponse.status).toBe(201);
    expect(firstWorkspace.slug).toBe('acme-labs');

    const duplicateWorkspaceResponse = await send('/api/workspaces', {
      method: 'POST',
      cookie,
      body: {
        name: 'Acme Labs'
      }
    });
    const duplicateWorkspacePayload = await parseJson(duplicateWorkspaceResponse);

    expect(duplicateWorkspaceResponse.status).toBe(409);
    expect(duplicateWorkspacePayload.error).toMatchObject({ code: 'WORKSPACE_ALREADY_EXISTS' });

    const secondWorkspaceResponse = await send('/api/workspaces', {
      method: 'POST',
      cookie,
      body: {
        name: 'Beta Labs'
      }
    });
    const secondWorkspacePayload = await parseJson(secondWorkspaceResponse);
    const secondWorkspace = secondWorkspacePayload.workspace as { id: string; slug: string; name: string };

    expect(secondWorkspaceResponse.status).toBe(201);
    expect(secondWorkspace.slug).toBe('beta-labs');
    expect(secondWorkspacePayload.activeWorkspaceId).toBe(secondWorkspace.id);

    const listResponse = await send('/api/workspaces', { cookie });
    const listPayload = await parseJson(listResponse);

    expect(listResponse.status).toBe(200);
    expect((listPayload.workspaces as unknown[]).length).toBe(2);
    expect(listPayload.activeWorkspaceId).toBe(secondWorkspace.id);

    const setActiveResponse = await send('/api/workspaces/active', {
      method: 'POST',
      cookie,
      body: {
        workspaceId: firstWorkspace.id
      }
    });
    const setActivePayload = await parseJson(setActiveResponse);

    expect(setActiveResponse.status).toBe(200);
    expect(setActivePayload.activeWorkspaceId).toBe(firstWorkspace.id);

    const activeWorkspaceResponse = await send('/api/workspaces/active', { cookie });
    const activeWorkspacePayload = await parseJson(activeWorkspaceResponse);

    expect(activeWorkspaceResponse.status).toBe(200);
    expect(activeWorkspacePayload.workspace).toMatchObject({
      id: firstWorkspace.id,
      name: 'Acme Labs'
    });
    expect(activeWorkspacePayload.member).toMatchObject({ role: 'owner' });
  });

  test('rejects replayed magic-link verification tokens', async () => {
    const { magicLink, verifyResponse } = await createAuthenticatedSession('replay@example.com');

    expect([200, 302]).toContain(verifyResponse.status);

    const replayResponse = await app.handle(new Request(magicLink.url));
    const replayCookie = convertSetCookieToCookie(replayResponse.headers).get('cookie') ?? '';

    expect(replayResponse.status).not.toBe(200);
    expect(replayCookie).toBe('');
  });
});
