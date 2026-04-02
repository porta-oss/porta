import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';

import {
  DEFAULT_AUTH_REDIRECT_PATH,
  getErrorMessage,
  normalizePostAuthRedirect,
  type AuthController,
  type AuthSnapshot,
  useAuthSnapshot
} from '../../lib/auth-client';
import { rootRoute } from '../__root';

export interface SignInSearch {
  redirect?: string;
  error?: string;
}

export interface SignInPageProps {
  auth: AuthController;
  search?: SignInSearch;
  navigateTo?: (to: string) => void;
}

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'auth/sign-in',
  validateSearch: (search): SignInSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    error: typeof search.error === 'string' ? search.error : undefined
  }),
  component: SignInRouteComponent
});

function SignInRouteComponent() {
  const { auth } = rootRoute.useRouteContext();
  const search = signInRoute.useSearch();
  const navigate = useNavigate();

  return (
    <SignInPage
      auth={auth}
      search={search}
      navigateTo={(to) => {
        void navigate({ to: to as '/app' | '/auth/sign-in' });
      }}
    />
  );
}

function getCallbackErrorMessage(errorCode: string | undefined) {
  switch (errorCode) {
    case 'INVALID_TOKEN':
      return 'Your magic link is invalid or has already been used.';
    case 'EXPIRED_TOKEN':
      return 'Your magic link expired. Request a new one to continue.';
    case 'ATTEMPTS_EXCEEDED':
      return 'That magic link can no longer be used. Request another one.';
    default:
      return errorCode ? 'Authentication could not be completed. Please try again.' : null;
  }
}

function SessionStateNotice({ snapshot }: { snapshot: AuthSnapshot }) {
  if (snapshot.status === 'loading') {
    return <p role="status">Checking for an existing founder session…</p>;
  }

  if (snapshot.status === 'error') {
    return <p role="alert">{snapshot.error?.message ?? 'Authentication is temporarily unavailable.'}</p>;
  }

  if (snapshot.status === 'authenticated') {
    return <p role="status">Session found. Redirecting you to the dashboard shell…</p>;
  }

  return <p role="status">No active session found. Choose Google or request a magic link.</p>;
}

export function SignInPage({ auth, search, navigateTo }: SignInPageProps) {
  const snapshot = useAuthSnapshot(auth);
  const [email, setEmail] = useState('');
  const [pendingAction, setPendingAction] = useState<'google' | 'magic-link' | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);
  const [isRetryingSession, setIsRetryingSession] = useState(false);

  const redirectTo = useMemo(() => normalizePostAuthRedirect(search?.redirect), [search?.redirect]);
  const callbackErrorMessage = useMemo(() => getCallbackErrorMessage(search?.error), [search?.error]);

  useEffect(() => {
    if (snapshot.status === 'idle') {
      void auth.bootstrapSession();
    }
  }, [auth, snapshot.status]);

  useEffect(() => {
    if (snapshot.status === 'authenticated') {
      navigateTo?.(redirectTo);
    }
  }, [navigateTo, redirectTo, snapshot.status]);

  async function handleGoogleSignIn() {
    setInlineError(null);
    setMagicLinkSentTo(null);
    setPendingAction('google');

    try {
      await auth.signInWithGoogle({ redirectTo });
    } catch (error) {
      setInlineError(getErrorMessage(error, 'Google sign-in could not be started.'));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRetrySession() {
    setInlineError(null);
    setIsRetryingSession(true);

    try {
      await auth.bootstrapSession({ force: true });
    } finally {
      setIsRetryingSession(false);
    }
  }

  async function handleMagicLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInlineError(null);
    setMagicLinkSentTo(null);

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setInlineError('Enter an email address to receive a magic link.');
      return;
    }

    setPendingAction('magic-link');

    try {
      await auth.signInWithMagicLink({
        email: trimmedEmail,
        redirectTo
      });
      setMagicLinkSentTo(trimmedEmail);
    } catch (error) {
      setInlineError(getErrorMessage(error, 'Magic-link sign-in could not be started.'));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main aria-label="sign-in page" style={{ maxWidth: '32rem', padding: '2rem 1.5rem' }}>
      <h1>Sign in to Founder Control Plane</h1>
      <p>Use Google OAuth or a magic link to enter your founder workspace.</p>

      <SessionStateNotice snapshot={snapshot} />
      {snapshot.status === 'error' ? (
        <button type="button" onClick={() => void handleRetrySession()} disabled={isRetryingSession}>
          {isRetryingSession ? 'Retrying session check…' : 'Retry session check'}
        </button>
      ) : null}

      {callbackErrorMessage ? <p role="alert">{callbackErrorMessage}</p> : null}
      {inlineError ? <p role="alert">{inlineError}</p> : null}
      {magicLinkSentTo ? <p role="status">Magic link requested for {magicLinkSentTo}.</p> : null}

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
        <button type="button" onClick={handleGoogleSignIn} disabled={pendingAction !== null}>
          {pendingAction === 'google' ? 'Starting Google sign-in…' : 'Continue with Google'}
        </button>

        <form onSubmit={handleMagicLinkSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
          <label htmlFor="magic-link-email">Work email</label>
          <input
            id="magic-link-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="founder@startup.com"
            value={email}
            onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          />
          <button type="submit" disabled={pendingAction !== null}>
            {pendingAction === 'magic-link' ? 'Sending magic link…' : 'Send magic link'}
          </button>
        </form>
      </div>

      <p style={{ marginTop: '1.5rem', color: '#4b5563' }}>
        After sign-in you will land in the protected dashboard shell at <code>{redirectTo || DEFAULT_AUTH_REDIRECT_PATH}</code>.
      </p>
      <p>
        Looking for the protected surface? <a href="/app">Open the guarded dashboard route</a>.
      </p>
    </main>
  );
}
