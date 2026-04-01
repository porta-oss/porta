import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AuthenticatedLayout } from './_authenticated';

describe('authenticated layout scaffold', () => {
  test('fails closed for signed-out users', () => {
    const html = renderToStaticMarkup(<AuthenticatedLayout />);

    expect(html).toContain('Redirecting to /auth/sign-in');
    expect(html).toContain('Protected routes fail closed');
  });

  test('renders a placeholder shell for authenticated users', () => {
    const html = renderToStaticMarkup(
      <AuthenticatedLayout isAuthenticated workspaceName="First Workspace" />
    );

    expect(html).toContain('First Workspace');
    expect(html).toContain('Authenticated dashboard shell scaffold');
  });
});
