import '../../test/setup-dom';

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import type { AuthController, AuthSnapshot } from '../../lib/auth-client';
import { SignInPage } from './sign-in';

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

  return { controller };
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

afterEach(() => {
  cleanup();
});

describe('sign-in route', () => {
  test('shows auth-unavailable state and retries the session bootstrap', async () => {
    const bootstrapSession = mock(async () => createSnapshot());
    const { controller } = createTestAuthController(
      createSnapshot({
        status: 'error',
        diagnostic: 'timeout',
        error: {
          code: 'AUTH_TIMEOUT',
          message: 'Authentication is taking too long. Retry the session check.'
        }
      }),
      { bootstrapSession }
    );

    const view = render(<SignInPage auth={controller} />);

    expect(view.getByRole('alert').textContent).toContain('Retry the session check');

    fireEvent.click(view.getByRole('button', { name: 'Retry session check' }));

    await waitFor(() => {
      expect(bootstrapSession).toHaveBeenCalledWith({ force: true });
    });
  });

  test('rejects an empty magic-link email before calling Better Auth', async () => {
    const signInWithMagicLink = mock(async () => {});
    const { controller } = createTestAuthController(createSnapshot(), { signInWithMagicLink });

    const view = render(<SignInPage auth={controller} />);

    fireEvent.click(view.getByRole('button', { name: 'Send magic link' }));

    expect((await view.findByRole('alert')).textContent).toContain('Enter an email address to receive a magic link.');
    expect(signInWithMagicLink).not.toHaveBeenCalled();
  });

  test('requests a magic link with the protected callback path and shows inline confirmation', async () => {
    const signInWithMagicLink = mock(async () => {});
    const { controller } = createTestAuthController(createSnapshot(), { signInWithMagicLink });

    const view = render(<SignInPage auth={controller} search={{ redirect: '/app' }} />);

    fireEvent.change(view.getByLabelText('Work email'), {
      target: { value: 'founder@example.com' }
    });
    fireEvent.click(view.getByRole('button', { name: 'Send magic link' }));

    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledWith({
        email: 'founder@example.com',
        redirectTo: '/app'
      });
    });

    expect(await view.findByText('Magic link requested for founder@example.com.')).toBeTruthy();
  });

  test('surfaces provider initiation failures inline and re-enables the page', async () => {
    const signInWithGoogle = mock(async () => {
      throw new Error('Google provider is unavailable right now.');
    });
    const { controller } = createTestAuthController(createSnapshot(), { signInWithGoogle });

    const view = render(<SignInPage auth={controller} />);

    fireEvent.click(view.getByRole('button', { name: 'Continue with Google' }));

    expect((await view.findByRole('alert')).textContent).toContain('Google provider is unavailable right now.');
    expect(view.getByRole('button', { name: 'Continue with Google' }).hasAttribute('disabled')).toBe(false);
  });

  test('falls back to the safe dashboard path when callback params are malformed', async () => {
    const navigateTo = mock(() => {});
    const { controller } = createTestAuthController(createAuthenticatedSnapshot());

    const view = render(
      <SignInPage
        auth={controller}
        search={{
          redirect: 'https://malicious.example.com/phish',
          error: 'INVALID_TOKEN'
        }}
        navigateTo={navigateTo}
      />
    );

    expect(view.getByRole('alert').textContent).toContain('Your magic link is invalid or has already been used.');

    await waitFor(() => {
      expect(navigateTo).toHaveBeenCalledWith('/app');
    });
  });
});
