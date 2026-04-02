import { useState } from 'react';

import type { ConnectorProvider, ConnectorSummary } from '@shared/connectors';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface PostHogFormValues {
  apiKey: string;
  projectId: string;
  host: string;
}

export interface StripeFormValues {
  secretKey: string;
}

export interface ConnectorSetupCardProps {
  provider: ConnectorProvider;
  /** Pre-existing connector for this provider (null = not connected). */
  existing: ConnectorSummary | null;
  disabled?: boolean;
  onConnect: (provider: ConnectorProvider, config: Record<string, string>) => Promise<void>;
  onSkip?: (provider: ConnectorProvider) => void;
}

// ------------------------------------------------------------------
// Validation helpers
// ------------------------------------------------------------------

function validatePostHogFields(values: PostHogFormValues): string | null {
  if (!values.apiKey.trim()) return 'PostHog API key cannot be blank.';
  if (!values.projectId.trim()) return 'PostHog project ID cannot be blank.';
  if (values.host.trim() && !/^https?:\/\/.+/i.test(values.host.trim())) {
    return 'PostHog host must be a valid URL starting with http:// or https://.';
  }
  return null;
}

function validateStripeFields(values: StripeFormValues): string | null {
  if (!values.secretKey.trim()) return 'Stripe secret key cannot be blank.';
  if (!/^(sk_live_|sk_test_|rk_live_|rk_test_)/.test(values.secretKey.trim())) {
    return 'Stripe key must start with sk_live_, sk_test_, rk_live_, or rk_test_.';
  }
  return null;
}

// ------------------------------------------------------------------
// Provider labels
// ------------------------------------------------------------------

const PROVIDER_LABELS: Record<ConnectorProvider, string> = {
  posthog: 'PostHog',
  stripe: 'Stripe',
  postgres: 'Postgres',
};

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function ConnectorSetupCard({
  provider,
  existing,
  disabled = false,
  onConnect,
  onSkip,
}: ConnectorSetupCardProps) {
  const [posthogValues, setPosthogValues] = useState<PostHogFormValues>({
    apiKey: '',
    projectId: '',
    host: '',
  });
  const [stripeValues, setStripeValues] = useState<StripeFormValues>({
    secretKey: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const label = PROVIDER_LABELS[provider];

  async function handleSubmit() {
    setError(null);

    let validationError: string | null = null;
    let config: Record<string, string> = {};

    if (provider === 'posthog') {
      validationError = validatePostHogFields(posthogValues);
      config = {
        apiKey: posthogValues.apiKey.trim(),
        projectId: posthogValues.projectId.trim(),
        host: posthogValues.host.trim() || 'https://us.posthog.com',
      };
    } else {
      validationError = validateStripeFields(stripeValues);
      config = { secretKey: stripeValues.secretKey.trim() };
    }

    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      await onConnect(provider, config);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Connection failed. Please retry.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  // If connector already exists, show connected state
  if (existing && existing.status !== 'disconnected') {
    return (
      <div
        aria-label={`${label} connector`}
        style={{
          display: 'grid',
          gap: '0.5rem',
          padding: '1rem',
          border: '1px solid #d1fae5',
          borderRadius: '0.75rem',
          background: '#ecfdf5',
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>{label}</p>
        <p role="status" style={{ margin: 0, color: '#065f46' }}>
          Connected
        </p>
      </div>
    );
  }

  const isDisabled = disabled || submitting;

  return (
    <form
      aria-label={`${label} setup form`}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
      style={{
        display: 'grid',
        gap: '0.75rem',
        padding: '1rem',
        border: '1px solid #e5e7eb',
        borderRadius: '0.75rem',
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>{label}</p>

      {provider === 'posthog' ? (
        <>
          <label htmlFor={`${provider}-api-key`}>API key</label>
          <input
            id={`${provider}-api-key`}
            type="text"
            placeholder="phc_..."
            value={posthogValues.apiKey}
            disabled={isDisabled}
            onInput={(e) =>
              setPosthogValues((v) => ({
                ...v,
                apiKey: (e.target as HTMLInputElement).value,
              }))
            }
          />
          <label htmlFor={`${provider}-project-id`}>Project ID</label>
          <input
            id={`${provider}-project-id`}
            type="text"
            placeholder="12345"
            value={posthogValues.projectId}
            disabled={isDisabled}
            onInput={(e) =>
              setPosthogValues((v) => ({
                ...v,
                projectId: (e.target as HTMLInputElement).value,
              }))
            }
          />
          <label htmlFor={`${provider}-host`}>Host (optional)</label>
          <input
            id={`${provider}-host`}
            type="text"
            placeholder="https://us.posthog.com"
            value={posthogValues.host}
            disabled={isDisabled}
            onInput={(e) =>
              setPosthogValues((v) => ({
                ...v,
                host: (e.target as HTMLInputElement).value,
              }))
            }
          />
        </>
      ) : (
        <>
          <label htmlFor={`${provider}-secret-key`}>Secret key</label>
          <input
            id={`${provider}-secret-key`}
            type="password"
            placeholder="sk_test_..."
            value={stripeValues.secretKey}
            disabled={isDisabled}
            onInput={(e) =>
              setStripeValues((v) => ({
                ...v,
                secretKey: (e.target as HTMLInputElement).value,
              }))
            }
          />
        </>
      )}

      {error ? (
        <p role="alert" style={{ margin: 0, color: '#991b1b' }}>
          {error}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={isDisabled}>
          {submitting ? `Connecting ${label}…` : `Connect ${label}`}
        </button>
        {onSkip ? (
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => onSkip(provider)}
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </form>
  );
}
