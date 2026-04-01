import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OnboardingPage } from './onboarding';

describe('onboarding route scaffold', () => {
  test('renders the first-startup onboarding placeholder with shared defaults', () => {
    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain('Create your first startup');
    expect(html).toContain('b2b_saas');
    expect(html).toContain('mvp');
  });
});
