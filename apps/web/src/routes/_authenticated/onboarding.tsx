import { DEFAULT_STARTUP_DRAFT } from '@shared/types';

export function OnboardingPage() {
  return (
    <main aria-label="startup onboarding">
      <h2>Create your first startup</h2>
      <p>Scaffolded onboarding flow for the first B2B SaaS startup.</p>
      <dl>
        <dt>Startup type</dt>
        <dd>{DEFAULT_STARTUP_DRAFT.type}</dd>
        <dt>Default stage</dt>
        <dd>{DEFAULT_STARTUP_DRAFT.stage}</dd>
      </dl>
    </main>
  );
}
