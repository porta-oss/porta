import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SignInPage } from './sign-in';

describe('sign-in route scaffold', () => {
  test('renders both planned auth entrypoints', () => {
    const html = renderToStaticMarkup(<SignInPage />);

    expect(html).toContain('Sign in to Founder Control Plane');
    expect(html).toContain('Google OAuth entrypoint scaffolded');
    expect(html).toContain('Email magic-link entrypoint scaffolded');
  });
});
