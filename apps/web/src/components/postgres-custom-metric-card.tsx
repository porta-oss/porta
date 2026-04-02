import type { CustomMetricSummary } from "@shared/custom-metric";
import { useState } from "react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface PostgresSetupFormValues {
  connectionUri: string;
  label: string;
  schema: string;
  unit: string;
  view: string;
}

export interface PostgresCustomMetricCardProps {
  /** Whether setup is disabled (e.g. during loading). */
  disabled?: boolean;
  /** Existing custom metric — null means not configured. */
  existing: CustomMetricSummary | null;
  /** Submit handler — receives the narrow contract fields. */
  onSetup: (values: PostgresSetupFormValues) => Promise<void>;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

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

  // If already configured, show the configured state
  if (existing) {
    const statusColor =
      existing.status === "active"
        ? "#065f46"
        : existing.status === "error"
          ? "#991b1b"
          : "#92400e";

    const statusLabel =
      existing.status === "active"
        ? "Syncing"
        : existing.status === "error"
          ? "Sync failed"
          : "Pending sync";

    return (
      <section
        aria-label="postgres custom metric"
        data-testid="postgres-custom-metric-configured"
        style={{
          display: "grid",
          gap: "0.5rem",
          padding: "1rem",
          border: `1px solid ${existing.status === "error" ? "#fecaca" : "#d1fae5"}`,
          borderRadius: "0.75rem",
          background: existing.status === "error" ? "#fef2f2" : "#ecfdf5",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>Postgres Custom Metric</p>
          <span
            role="status"
            style={{ fontSize: "0.8rem", fontWeight: 500, color: statusColor }}
          >
            {statusLabel}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#374151" }}>
          {existing.label} ({existing.schema}.{existing.view})
        </p>
      </section>
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
    <form
      aria-label="Postgres custom metric setup form"
      data-testid="postgres-custom-metric-setup"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
      style={{
        display: "grid",
        gap: "0.75rem",
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
      }}
    >
      <div>
        <p style={{ margin: 0, fontWeight: 600 }}>Postgres Custom Metric</p>
        <p
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.85rem",
            color: "#6b7280",
          }}
        >
          Connect a read-only Postgres view to track one custom metric on the
          health dashboard.
        </p>
      </div>

      <label htmlFor="pg-connection-uri">Connection URI</label>
      <input
        disabled={isDisabled}
        id="pg-connection-uri"
        onInput={(e) =>
          setValues((v) => ({
            ...v,
            connectionUri: (e.target as HTMLInputElement).value,
          }))
        }
        placeholder="postgresql://user:pass@host:5432/db"
        type="password"
        value={values.connectionUri}
      />

      <label htmlFor="pg-schema">Schema</label>
      <input
        disabled={isDisabled}
        id="pg-schema"
        onInput={(e) =>
          setValues((v) => ({
            ...v,
            schema: (e.target as HTMLInputElement).value,
          }))
        }
        placeholder="public"
        type="text"
        value={values.schema}
      />

      <label htmlFor="pg-view">View</label>
      <input
        disabled={isDisabled}
        id="pg-view"
        onInput={(e) =>
          setValues((v) => ({
            ...v,
            view: (e.target as HTMLInputElement).value,
          }))
        }
        placeholder="daily_revenue"
        type="text"
        value={values.view}
      />

      <label htmlFor="pg-label">Label</label>
      <input
        disabled={isDisabled}
        id="pg-label"
        onInput={(e) =>
          setValues((v) => ({
            ...v,
            label: (e.target as HTMLInputElement).value,
          }))
        }
        placeholder="Daily Revenue"
        type="text"
        value={values.label}
      />

      <label htmlFor="pg-unit">Unit</label>
      <input
        disabled={isDisabled}
        id="pg-unit"
        onInput={(e) =>
          setValues((v) => ({
            ...v,
            unit: (e.target as HTMLInputElement).value,
          }))
        }
        placeholder="$"
        type="text"
        value={values.unit}
      />

      {error ? (
        <p role="alert" style={{ margin: 0, color: "#991b1b" }}>
          {error}
        </p>
      ) : null}

      <button disabled={isDisabled} type="submit">
        {submitting ? "Setting up…" : "Add Postgres metric"}
      </button>
    </form>
  );
}
