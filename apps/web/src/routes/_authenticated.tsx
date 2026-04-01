import type { ReactNode } from 'react';

export interface AuthenticatedLayoutProps {
  isAuthenticated?: boolean;
  workspaceName?: string | null;
  children?: ReactNode;
}

export function AuthenticatedLayout({
  isAuthenticated = false,
  workspaceName,
  children
}: AuthenticatedLayoutProps) {
  if (!isAuthenticated) {
    return (
      <main aria-label="auth gate">
        <h1>Redirecting to /auth/sign-in</h1>
        <p>Protected routes fail closed until a valid session exists.</p>
      </main>
    );
  }

  return (
    <section aria-label="authenticated shell">
      <header>
        <h1>{workspaceName ?? 'Workspace setup pending'}</h1>
        <p>Authenticated dashboard shell scaffold</p>
      </header>
      <div>{children ?? <p>No startups yet. Finish onboarding to populate the shell.</p>}</div>
    </section>
  );
}
