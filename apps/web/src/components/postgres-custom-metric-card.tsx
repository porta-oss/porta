import type { CustomMetricSummary } from "@shared/custom-metric";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PostgresSetupFormValues {
  connectionUri: string;
  label: string;
  schema: string;
  unit: string;
  view: string;
}

export interface PostgresCustomMetricCardProps {
  disabled?: boolean;
  existing: CustomMetricSummary | null;
  onSetup: (values: PostgresSetupFormValues) => Promise<void>;
}

const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function validateSetupFields(values: PostgresSetupFormValues): string | null {
  if (!values.connectionUri.trim()) {
    return "Connection URI is required.";
  }
  try {
    const url = new URL(values.connectionUri.trim());
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return "Connection URI must use the postgres:// or postgresql:// scheme.";
    }
  } catch {
    return "Connection URI must be a valid URL with the postgres:// or postgresql:// scheme.";
  }

  if (!values.schema.trim()) {
    return "Schema name is required.";
  }
  if (!SQL_IDENTIFIER_RE.test(values.schema.trim())) {
    return "Schema must be SQL-safe: start with a letter or underscore, only letters/digits/underscores, max 63 characters.";
  }

  if (!values.view.trim()) {
    return "View name is required.";
  }
  if (!SQL_IDENTIFIER_RE.test(values.view.trim())) {
    return "View must be SQL-safe: start with a letter or underscore, only letters/digits/underscores, max 63 characters.";
  }

  if (!values.label.trim()) {
    return "Label must not be blank.";
  }
  if (values.label.trim().length > 100) {
    return "Label must be 100 characters or fewer.";
  }

  if (!values.unit.trim()) {
    return "Unit must not be blank.";
  }
  if (values.unit.trim().length > 20) {
    return "Unit must be 20 characters or fewer.";
  }

  return null;
}

export function PostgresCustomMetricCard({
  existing,
  disabled = false,
  onSetup,
}: PostgresCustomMetricCardProps) {
  const [values, setValues] = useState<PostgresSetupFormValues>({
    connectionUri: "",
    schema: "public",
    view: "",
    label: "",
    unit: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (existing) {
    let statusLabel: string;
    if (existing.status === "active") {
      statusLabel = "Syncing";
    } else if (existing.status === "error") {
      statusLabel = "Sync failed";
    } else {
      statusLabel = "Pending sync";
    }

    return (
      <Card
        aria-label="postgres custom metric"
        className={
          existing.status === "error"
            ? "border-danger-border bg-danger-bg"
            : "border-success-border bg-success-bg"
        }
        data-testid="postgres-custom-metric-configured"
      >
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Postgres Custom Metric</p>
            <Badge
              variant={
                existing.status === "error" ? "destructive" : "secondary"
              }
            >
              {statusLabel}
            </Badge>
          </div>
          <p className="mt-1 text-sm">
            {existing.label} ({existing.schema}.{existing.view})
          </p>
        </CardContent>
      </Card>
    );
  }

  const isDisabled = disabled || submitting;

  async function handleSubmit() {
    setError(null);

    const validationError = validateSetupFields(values);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      await onSetup({
        connectionUri: values.connectionUri.trim(),
        schema: values.schema.trim(),
        view: values.view.trim(),
        label: values.label.trim(),
        unit: values.unit.trim(),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Postgres custom metric setup failed. Please retry."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      aria-label="Postgres custom metric setup form"
      data-testid="postgres-custom-metric-setup"
    >
      <CardHeader>
        <CardTitle>Postgres Custom Metric</CardTitle>
        <CardDescription>
          Connect a read-only Postgres view to track one custom metric on the
          health dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="pg-connection-uri">Connection URI</Label>
            <Input
              disabled={isDisabled}
              id="pg-connection-uri"
              onChange={(e) =>
                setValues((v) => ({ ...v, connectionUri: e.target.value }))
              }
              placeholder="postgresql://user:pass@host:5432/db"
              type="password"
              value={values.connectionUri}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pg-schema">Schema</Label>
            <Input
              disabled={isDisabled}
              id="pg-schema"
              onChange={(e) =>
                setValues((v) => ({ ...v, schema: e.target.value }))
              }
              placeholder="public"
              type="text"
              value={values.schema}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pg-view">View</Label>
            <Input
              disabled={isDisabled}
              id="pg-view"
              onChange={(e) =>
                setValues((v) => ({ ...v, view: e.target.value }))
              }
              placeholder="daily_revenue"
              type="text"
              value={values.view}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pg-label">Label</Label>
            <Input
              disabled={isDisabled}
              id="pg-label"
              onChange={(e) =>
                setValues((v) => ({ ...v, label: e.target.value }))
              }
              placeholder="Daily Revenue"
              type="text"
              value={values.label}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pg-unit">Unit</Label>
            <Input
              disabled={isDisabled}
              id="pg-unit"
              onChange={(e) =>
                setValues((v) => ({ ...v, unit: e.target.value }))
              }
              placeholder="$"
              type="text"
              value={values.unit}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button disabled={isDisabled} type="submit">
            {submitting ? "Setting up\u2026" : "Add Postgres metric"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
