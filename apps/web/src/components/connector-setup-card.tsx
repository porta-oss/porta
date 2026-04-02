import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PostHogFormValues {
  apiKey: string;
  host: string;
  projectId: string;
}

export interface StripeFormValues {
  secretKey: string;
}

export interface ConnectorSetupCardProps {
  disabled?: boolean;
  existing: ConnectorSummary | null;
  onConnect: (
    provider: ConnectorProvider,
    config: Record<string, string>
  ) => Promise<void>;
  onSkip?: (provider: ConnectorProvider) => void;
  provider: ConnectorProvider;
}

interface ConnectorFormValues {
  apiKey: string;
  host: string;
  projectId: string;
  secretKey: string;
}

function validatePostHogFields(values: PostHogFormValues): string | null {
  if (!values.apiKey.trim()) {
    return "PostHog API key cannot be blank.";
  }
  if (!values.projectId.trim()) {
    return "PostHog project ID cannot be blank.";
  }
  if (values.host.trim() && !/^https?:\/\/.+/i.test(values.host.trim())) {
    return "PostHog host must be a valid URL starting with http:// or https://.";
  }
  return null;
}

function validateStripeFields(values: StripeFormValues): string | null {
  if (!values.secretKey.trim()) {
    return "Stripe secret key cannot be blank.";
  }
  if (!/^(sk_live_|sk_test_|rk_live_|rk_test_)/.test(values.secretKey.trim())) {
    return "Stripe key must start with sk_live_, sk_test_, rk_live_, or rk_test_.";
  }
  return null;
}

const PROVIDER_LABELS: Record<ConnectorProvider, string> = {
  posthog: "PostHog",
  stripe: "Stripe",
  postgres: "Postgres",
};

export function ConnectorSetupCard({
  provider,
  existing,
  disabled = false,
  onConnect,
  onSkip,
}: ConnectorSetupCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const label = PROVIDER_LABELS[provider];

  async function handleSubmit(formValues: ConnectorFormValues) {
    setError(null);

    let validationError: string | null = null;
    let config: Record<string, string> = {};

    if (provider === "posthog") {
      const posthogValues: PostHogFormValues = {
        apiKey: formValues.apiKey,
        projectId: formValues.projectId,
        host: formValues.host,
      };
      validationError = validatePostHogFields(posthogValues);
      config = {
        apiKey: posthogValues.apiKey.trim(),
        projectId: posthogValues.projectId.trim(),
        host: posthogValues.host.trim() || "https://us.posthog.com",
      };
    } else {
      const stripeValues: StripeFormValues = {
        secretKey: formValues.secretKey,
      };
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
        err instanceof Error
          ? err.message
          : "Could not connect. Check your credentials and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (existing && existing.status !== "disconnected") {
    return (
      <Card
        aria-label={`${label} connector`}
        className="border-success-border bg-success-bg"
      >
        <CardContent className="pt-5">
          <p className="font-semibold">{label}</p>
          <p className="text-success" role="status">
            Connected
          </p>
        </CardContent>
      </Card>
    );
  }

  const isDisabled = disabled || submitting;

  return (
    <Card aria-label={`${label} setup form`}>
      <CardContent className="pt-5">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            void handleSubmit({
              apiKey: String(formData.get("apiKey") ?? ""),
              host: String(formData.get("host") ?? ""),
              projectId: String(formData.get("projectId") ?? ""),
              secretKey: String(formData.get("secretKey") ?? ""),
            });
          }}
        >
          <p className="font-semibold">{label}</p>

          {provider === "posthog" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`${provider}-api-key`}>API key</Label>
                <Input
                  defaultValue=""
                  disabled={isDisabled}
                  id={`${provider}-api-key`}
                  name="apiKey"
                  placeholder="phc_..."
                  type="text"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${provider}-project-id`}>Project ID</Label>
                <Input
                  defaultValue=""
                  disabled={isDisabled}
                  id={`${provider}-project-id`}
                  name="projectId"
                  placeholder="12345"
                  type="text"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${provider}-host`}>Host (optional)</Label>
                <Input
                  defaultValue=""
                  disabled={isDisabled}
                  id={`${provider}-host`}
                  name="host"
                  placeholder="https://us.posthog.com"
                  type="text"
                />
              </div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor={`${provider}-secret-key`}>Secret key</Label>
              <Input
                defaultValue=""
                disabled={isDisabled}
                id={`${provider}-secret-key`}
                name="secretKey"
                placeholder="sk_test_..."
                type="password"
              />
            </div>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button disabled={isDisabled} type="submit">
              {submitting ? `Connecting ${label}\u2026` : `Connect ${label}`}
            </Button>
            {onSkip ? (
              <Button
                disabled={isDisabled}
                onClick={() => onSkip(provider)}
                type="button"
                variant="outline"
              >
                Skip for now
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
