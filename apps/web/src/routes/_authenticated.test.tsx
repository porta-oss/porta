import '../test/setup-dom';

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';

import type { AuthController, AuthSnapshot } from '../lib/auth-client';
import { createAppRouter } from '../router';

function createSnapshot(overrides: Partial<AuthSnapshot> = {}): AuthSnapshot {
  return {
    status: 'signed-out',
    session: null,
    error: null,
    diagnostic: 'missing-session',
    lastResolvedAt: null,
    ...overrides
  };
}

function createAuthenticatedSnapshot(): AuthSnapshot {
  return createSnapshot({
    status: 'authenticated',
    diagnostic: 'none',
    session: {
      user: {
        id: 'user_123',
        email: 'founder@example.com',
        name: 'Founder',
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true
      },
      session: {
        id: 'session_123',
        userId: 'user_123',
        expiresAt: new Date(),
        activeOrganizationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        token: 'token_123',
        ipAddress: null,
        userAgent: null
      }
    }
  });
}

function createTestAuthController(
  initialSnapshot = createSnapshot(),
  overrides: Partial<AuthController> = {}
) {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();

  const controller: AuthController = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bootstrapSession: overrides.bootstrapSession ?? mock(async () => snapshot),
    signInWithGoogle: overrides.signInWithGoogle ?? mock(async () => {}),
    signInWithMagicLink: overrides.signInWithMagicLink ?? mock(async () => {}),
    markSignedOut: overrides.markSignedOut ?? mock(() => {
      snapshot = createSnapshot();
      listeners.forEach((listener) => listener());
    })
  };

  return {
    controller,
    setSnapshot(next: AuthSnapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    }
  };
}

function renderProtectedRoute(auth: AuthController) {
  const history = createMemoryHistory({ initialEntries: ['/app'] });
  const router = createAppRouter(auth, { history });
  const view = render(<RouterProvider router={router} />);

  return { router, view };
}

afterEach(() => {
  cleanup();
});

describe('authenticated route guard', () => {
  test('redirects signed-out users to /auth/sign-in', async () => {
    const bootstrapSession = mock(async () => createSnapshot({ diagnostic: 'missing-session' }));
    const { controller } = createTestAuthController(createSnapshot(), { bootstrapSession });
    const { router, view } = renderProtectedRoute(controller);

    expect(await view.findByRole('main', { name: 'sign-in page' })).toBeTruthy();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auth/sign-in');
      expect(router.state.location.search).toMatchObject({ redirect: '/app' });
    });
  });

  test('shows a deterministic loading shell while the session bootstrap is pending', async () => {
    let resolveBootstrap: ((value: AuthSnapshot) => void) | undefined;
    const deferred = new Promise<AuthSnapshot>((resolve) => {
      resolveBootstrap = resolve;
    });
    const bootstrapSession = mock(() => deferred);
    const { controller, setSnapshot } = createTestAuthController(createSnapshot({ status: 'idle' }), { bootstrapSession });

    const { view } = renderProtectedRoute(controller);

    expect(await view.findByRole('main', { name: 'auth bootstrap' })).toBeTruthy();
    expect(view.getByText('The dashboard stays locked until the session bootstrap resolves.')).toBeTruthy();

    const authenticatedSnapshot = createAuthenticatedSnapshot();
    setSnapshot(authenticatedSnapshot);
    resolveBootstrap?.(authenticatedSnapshot);

    expect(await view.findByRole('main', { name: 'dashboard placeholder' })).toBeTruthy();
  });

  test('unlocks the guarded route tree for authenticated sessions', async () => {
    const bootstrapSession = mock(async () => createAuthenticatedSnapshot());
    const { controller } = createTestAuthController(createAuthenticatedSnapshot(), { bootstrapSession });
    const { router, view } = renderProtectedRoute(controller);

    expect(await view.findByRole('main', { name: 'dashboard placeholder' })).toBeTruthy();
    expect(view.getByText('Dashboard access is unlocked because a valid Better Auth session exists.')).toBeTruthy();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app');
    });
  });

  test('treats malformed session bootstrap results as unauthenticated and redirects safely', async () => {
    const malformedSignedOut = createSnapshot({
      status: 'signed-out',
      diagnostic: 'malformed-session'
    });
    const bootstrapSession = mock(async () => malformedSignedOut);
    const { controller } = createTestAuthController(createSnapshot(), { bootstrapSession });
    const { router, view } = renderProtectedRoute(controller);

    expect(await view.findByRole('main', { name: 'sign-in page' })).toBeTruthy();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auth/sign-in');
      expect(router.state.location.search).toMatchObject({ redirect: '/app' });
    });
  });
});
