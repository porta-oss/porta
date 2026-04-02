# shadcn/ui Full Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all raw HTML elements and inline styles with shadcn/ui components across the entire dashboard UI.

**Architecture:** Install missing shadcn/ui primitives (Input, Card, Badge, Alert, Select, Label, Separator), then migrate each component file bottom-up: leaf components first, then composites, then routes. Every raw `<section style={...}>` becomes `<Card>`, every `<button>` becomes `<Button>`, every `<input>` becomes `<Input>`, etc. Inline `style={{}}` objects are replaced with Tailwind utility classes.

**Tech Stack:** React 19, shadcn/ui v4 (radix-luma style), Tailwind CSS 4, Radix UI, Lucide React, class-variance-authority

---

## File Map

### New files (shadcn installations):
- `apps/web/src/components/ui/input.tsx` — shadcn Input
- `apps/web/src/components/ui/card.tsx` — shadcn Card (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
- `apps/web/src/components/ui/badge.tsx` — shadcn Badge
- `apps/web/src/components/ui/alert.tsx` — shadcn Alert + AlertDescription
- `apps/web/src/components/ui/select.tsx` — shadcn Select (Select, SelectTrigger, SelectValue, SelectContent, SelectItem)
- `apps/web/src/components/ui/label.tsx` — shadcn Label
- `apps/web/src/components/ui/separator.tsx` — shadcn Separator
- `apps/web/src/components/ui/progress.tsx` — shadcn Progress (for funnel bars)

### Modified files (migration order):
1. `apps/web/src/components/workspace-switcher.tsx` — Card + Select + Button + Label + Alert
2. `apps/web/src/components/startup-list.tsx` — Card + Button + Alert + Badge
3. `apps/web/src/components/connector-setup-card.tsx` — Card + Input + Button + Label + Alert
4. `apps/web/src/components/postgres-custom-metric-card.tsx` — Card + Input + Button + Label + Alert
5. `apps/web/src/components/startup-form.tsx` — Select + Input + Button + Label + Alert
6. `apps/web/src/components/connector-status-panel.tsx` — Card + Button + Badge + Alert
7. `apps/web/src/components/custom-metric-panel.tsx` — Card + Badge + Alert
8. `apps/web/src/components/startup-metrics-grid.tsx` — Card
9. `apps/web/src/components/startup-funnel-panel.tsx` — Card + Progress
10. `apps/web/src/components/startup-health-hero.tsx` — Card + Badge
11. `apps/web/src/components/startup-task-list.tsx` — Card + Badge + Button + Alert
12. `apps/web/src/components/startup-insight-card.tsx` — Card + Badge + Button + Alert
13. `apps/web/src/components/portfolio-startup-card.tsx` — Card + Badge
14. `apps/web/src/components/app-shell.tsx` — Card + Button + Alert
15. `apps/web/src/routes/__root.tsx` — Separator + Alert
16. `apps/web/src/routes/_authenticated.tsx` — Card
17. `apps/web/src/routes/auth/sign-in.tsx` — Card + Input + Button + Label + Alert + Separator

---

## Task 1: Install shadcn/ui Components

**Files:**
- Create: `apps/web/src/components/ui/input.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/alert.tsx`
- Create: `apps/web/src/components/ui/select.tsx`
- Create: `apps/web/src/components/ui/label.tsx`
- Create: `apps/web/src/components/ui/separator.tsx`
- Create: `apps/web/src/components/ui/progress.tsx`

- [ ] **Step 1: Install all required shadcn components**

Run from `apps/web/`:

```bash
cd apps/web && bunx shadcn@latest add input card badge alert select label separator progress
```

This installs all components into `src/components/ui/` using the config from `components.json`.

- [ ] **Step 2: Verify installation**

```bash
ls apps/web/src/components/ui/
```

Expected: `alert.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `progress.tsx`, `select.tsx`, `separator.tsx`

- [ ] **Step 3: Verify the app still builds**

```bash
cd apps/web && bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat: install shadcn/ui components (input, card, badge, alert, select, label, separator, progress)"
```

---

## Task 2: Migrate WorkspaceSwitcher

**Files:**
- Modify: `apps/web/src/components/workspace-switcher.tsx`

This component currently uses raw `<section>`, `<select>`, `<button>`, `<label>`, and `<p>` with inline styles.

- [ ] **Step 1: Rewrite workspace-switcher.tsx**

Replace the entire component body with shadcn/ui primitives. Keep the same props interface, state logic, and behavior. Replace:
- `<section style={{...}}>` → `<Card>`
- `<select>` → `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`
- `<button>` → `<Button>`
- `<label>` → `<Label>`
- `<p role="alert">` → `<Alert variant="destructive">`
- All inline `style={{}}` → Tailwind utility classes

```tsx
import type { WorkspaceSummary } from "@shared/types";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface WorkspaceSwitcherProps {
  activeWorkspaceId: string | null;
  error?: string | null;
  isLoading?: boolean;
  isSwitching?: boolean;
  onActivateWorkspace?: (workspaceId: string) => void | Promise<void>;
  startupCount: number;
  workspaces: WorkspaceSummary[];
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  startupCount,
  isLoading = false,
  isSwitching = false,
  error = null,
  onActivateWorkspace,
}: WorkspaceSwitcherProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    activeWorkspaceId ?? ""
  );

  useEffect(() => {
    setSelectedWorkspaceId(activeWorkspaceId ?? "");
  }, [activeWorkspaceId]);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const canSwitch =
    Boolean(selectedWorkspaceId) &&
    selectedWorkspaceId !== activeWorkspaceId &&
    !isLoading &&
    !isSwitching;

  return (
    <Card aria-label="workspace switcher">
      <CardHeader>
        <CardDescription className="text-xs uppercase tracking-wider">
          Active workspace
        </CardDescription>
        <CardTitle className="text-lg">
          {activeWorkspace?.name ?? "No active workspace yet"}
        </CardTitle>
        <CardDescription>
          {activeWorkspace
            ? `${startupCount} ${startupCount === 1 ? "startup" : "startups"} in this workspace.`
            : "Create a workspace to get started."}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3">
        {workspaces.length > 0 ? (
          <>
            <Label htmlFor="workspace-switcher-select">Switch workspace</Label>
            <div className="flex flex-wrap gap-3">
              <Select
                disabled={isLoading || isSwitching}
                onValueChange={setSelectedWorkspaceId}
                value={selectedWorkspaceId}
              >
                <SelectTrigger className="min-w-56" id="workspace-switcher-select">
                  <SelectValue placeholder="Choose a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!canSwitch}
                onClick={() => void onActivateWorkspace?.(selectedWorkspaceId)}
                variant="outline"
              >
                {isSwitching ? "Switching\u2026" : "Switch"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No workspaces yet. Complete setup to create one.
          </p>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the app builds**

```bash
cd apps/web && bun run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace-switcher.tsx
git commit -m "refactor: migrate WorkspaceSwitcher to shadcn/ui"
```

---

## Task 3: Migrate StartupList

**Files:**
- Modify: `apps/web/src/components/startup-list.tsx`

- [ ] **Step 1: Rewrite startup-list.tsx**

Replace:
- Outer `<section style={{...}}>` → `<Card>`
- Error `<p role="alert">` → `<Alert variant="destructive">`
- `<button>` → `<Button>`
- All inline styles → Tailwind classes

```tsx
import type { StartupRecord } from "@shared/types";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface StartupListProps {
  error?: string | null;
  onRetry?: () => void | Promise<void>;
  startups: StartupRecord[];
  status: "idle" | "loading" | "refreshing" | "ready" | "error";
  workspaceName: string | null;
}

export function StartupList({
  workspaceName,
  startups,
  status,
  error = null,
  onRetry,
}: StartupListProps) {
  const isBusy = status === "loading" || status === "refreshing";

  return (
    <Card aria-label="startup list">
      <CardHeader>
        <CardDescription className="text-xs uppercase tracking-wider">
          Startups
        </CardDescription>
        <CardTitle className="text-lg">
          {workspaceName ? `${workspaceName} startups` : "Portfolio navigation"}
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-3">
        {status === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">Loading startups\u2026</p>
        ) : null}
        {status === "refreshing" ? (
          <p role="status" className="text-sm text-muted-foreground">Refreshing startups\u2026</p>
        ) : null}

        {status === "error" ? (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertDescription>
                {error ?? "Startups could not be loaded."}
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => void onRetry?.()}>
              Try again
            </Button>
          </div>
        ) : null}

        {status !== "error" && !workspaceName ? (
          <div className="grid gap-2">
            <p className="text-sm">Select a workspace to see your startups.</p>
            <a href="/app/onboarding" className="text-sm text-primary underline underline-offset-4">
              Set up a workspace
            </a>
          </div>
        ) : null}

        {status !== "error" &&
        workspaceName &&
        startups.length === 0 &&
        !isBusy ? (
          <div className="grid gap-2">
            <p className="text-sm">
              No startups are attached to this workspace yet.
            </p>
            <a href="/app/onboarding" className="text-sm text-primary underline underline-offset-4">
              Add the first startup profile
            </a>
          </div>
        ) : null}

        {startups.length > 0 ? (
          <ul className="m-0 grid gap-3 pl-4">
            {startups.map((startup, index) => (
              <li key={startup.id}>
                <strong>{startup.name}</strong>
                <div className="text-sm text-muted-foreground">
                  {index === 0 ? "Primary startup" : "Startup"} ·{" "}
                  {startup.stage.replace("_", " ")} ·{" "}
                  {startup.type.replace("_", " ")} · {startup.timezone} ·{" "}
                  {startup.currency}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/startup-list.tsx
git commit -m "refactor: migrate StartupList to shadcn/ui"
```

---

## Task 4: Migrate ConnectorSetupCard

**Files:**
- Modify: `apps/web/src/components/connector-setup-card.tsx`

- [ ] **Step 1: Rewrite connector-setup-card.tsx**

Replace:
- Connected state `<section style={{...}}>` → `<Card>` with success border class
- Form `<form style={{...}}>` → `<Card>` wrapping a `<form>`
- `<label>` → `<Label>`
- `<input>` → `<Input>`
- `<button>` → `<Button>`
- `<p role="alert">` → `<Alert variant="destructive">`

```tsx
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [posthogValues, setPosthogValues] = useState<PostHogFormValues>({
    apiKey: "",
    projectId: "",
    host: "",
  });
  const [stripeValues, setStripeValues] = useState<StripeFormValues>({
    secretKey: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const label = PROVIDER_LABELS[provider];

  async function handleSubmit() {
    setError(null);

    let validationError: string | null = null;
    let config: Record<string, string> = {};

    if (provider === "posthog") {
      validationError = validatePostHogFields(posthogValues);
      config = {
        apiKey: posthogValues.apiKey.trim(),
        projectId: posthogValues.projectId.trim(),
        host: posthogValues.host.trim() || "https://us.posthog.com",
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
      <Card aria-label={`${label} connector`} className="border-success-border bg-success-bg">
        <CardContent className="pt-6">
          <p className="font-semibold">{label}</p>
          <p role="status" className="text-success">Connected</p>
        </CardContent>
      </Card>
    );
  }

  const isDisabled = disabled || submitting;

  return (
    <Card aria-label={`${label} setup form`}>
      <CardContent className="pt-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="grid gap-3"
        >
          <p className="font-semibold">{label}</p>

          {provider === "posthog" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`${provider}-api-key`}>API key</Label>
                <Input
                  disabled={isDisabled}
                  id={`${provider}-api-key`}
                  onChange={(e) =>
                    setPosthogValues((v) => ({ ...v, apiKey: e.target.value }))
                  }
                  placeholder="phc_..."
                  type="text"
                  value={posthogValues.apiKey}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${provider}-project-id`}>Project ID</Label>
                <Input
                  disabled={isDisabled}
                  id={`${provider}-project-id`}
                  onChange={(e) =>
                    setPosthogValues((v) => ({ ...v, projectId: e.target.value }))
                  }
                  placeholder="12345"
                  type="text"
                  value={posthogValues.projectId}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${provider}-host`}>Host (optional)</Label>
                <Input
                  disabled={isDisabled}
                  id={`${provider}-host`}
                  onChange={(e) =>
                    setPosthogValues((v) => ({ ...v, host: e.target.value }))
                  }
                  placeholder="https://us.posthog.com"
                  type="text"
                  value={posthogValues.host}
                />
              </div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor={`${provider}-secret-key`}>Secret key</Label>
              <Input
                disabled={isDisabled}
                id={`${provider}-secret-key`}
                onChange={(e) =>
                  setStripeValues((v) => ({ ...v, secretKey: e.target.value }))
                }
                placeholder="sk_test_..."
                type="password"
                value={stripeValues.secretKey}
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
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/connector-setup-card.tsx
git commit -m "refactor: migrate ConnectorSetupCard to shadcn/ui"
```

---

## Task 5: Migrate PostgresCustomMetricCard

**Files:**
- Modify: `apps/web/src/components/postgres-custom-metric-card.tsx`

- [ ] **Step 1: Rewrite postgres-custom-metric-card.tsx**

Same pattern as ConnectorSetupCard. Replace all raw elements with shadcn components:
- Configured state `<section>` → `<Card>`
- Form `<form>` → `<Card>` wrapping `<form>`
- `<label>` → `<Label>`, `<input>` → `<Input>`, `<button>` → `<Button>`
- `<p role="alert">` → `<Alert variant="destructive">`
- Status `<span role="status">` → `<Badge>`

```tsx
import type { CustomMetricSummary } from "@shared/custom-metric";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    const variant = existing.status === "error" ? "destructive" : "default";
    const statusLabel =
      existing.status === "active"
        ? "Syncing"
        : existing.status === "error"
          ? "Sync failed"
          : "Pending sync";

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
            <Badge variant={variant === "destructive" ? "destructive" : "secondary"}>
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
    <Card aria-label="Postgres custom metric setup form" data-testid="postgres-custom-metric-setup">
      <CardHeader>
        <CardTitle>Postgres Custom Metric</CardTitle>
        <CardDescription>
          Connect a read-only Postgres view to track one custom metric on the
          health dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="grid gap-3"
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
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/postgres-custom-metric-card.tsx
git commit -m "refactor: migrate PostgresCustomMetricCard to shadcn/ui"
```

---

## Task 6: Migrate StartupForm

**Files:**
- Modify: `apps/web/src/components/startup-form.tsx`

- [ ] **Step 1: Rewrite startup-form.tsx**

Replace:
- `<form style={{...}}>` → `<form className="grid gap-3">`
- `<label>` → `<Label>`
- `<input>` → `<Input>`
- `<select>` → `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`
- `<button>` → `<Button>`
- `<p role="alert">` → `<Alert variant="destructive">`

```tsx
import {
  STARTUP_CURRENCIES,
  STARTUP_STAGES,
  STARTUP_TIMEZONES,
  STARTUP_TYPES,
  type StartupDraft,
} from "@shared/types";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface StartupFormProps {
  disabled?: boolean;
  error?: string | null;
  onChange: (next: StartupDraft) => void;
  onSubmit: () => void | Promise<void>;
  value: StartupDraft;
}

export function StartupForm({
  value,
  disabled = false,
  error = null,
  onChange,
  onSubmit,
}: StartupFormProps) {
  return (
    <form
      aria-label="startup form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      className="grid gap-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="startup-name">Startup name</Label>
        <Input
          disabled={disabled}
          id="startup-name"
          name="name"
          onChange={(event) =>
            onChange({ ...value, name: event.target.value })
          }
          placeholder="Acme Analytics"
          type="text"
          value={value.name}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-type">Startup type</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, type: v as StartupDraft["type"] })
          }
          value={value.type}
        >
          <SelectTrigger id="startup-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-stage">Stage</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, stage: v as StartupDraft["stage"] })
          }
          value={value.stage}
        >
          <SelectTrigger id="startup-stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {stage}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-timezone">Timezone</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, timezone: v as StartupDraft["timezone"] })
          }
          value={value.timezone}
        >
          <SelectTrigger id="startup-timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_TIMEZONES.map((timezone) => (
              <SelectItem key={timezone} value={timezone}>
                {timezone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-currency">Currency</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, currency: v as StartupDraft["currency"] })
          }
          value={value.currency}
        >
          <SelectTrigger id="startup-currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_CURRENCIES.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button disabled={disabled} type="submit">
        {disabled ? "Creating startup\u2026" : "Create startup"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/startup-form.tsx
git commit -m "refactor: migrate StartupForm to shadcn/ui"
```

---

## Task 7: Migrate ConnectorStatusPanel

**Files:**
- Modify: `apps/web/src/components/connector-status-panel.tsx`

- [ ] **Step 1: Rewrite connector-status-panel.tsx**

Replace:
- Outer `<section>` → `<Card>`
- Connector `<article>` → `<Card>` (nested)
- Status `<span role="status">` → `<Badge>`
- `<button>` → `<Button>`
- `<p role="alert">` → `<Alert variant="destructive">`
- All inline styles → Tailwind classes

```tsx
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface ConnectorStatusPanelProps {
  connectors: ConnectorSummary[];
  error?: string | null;
  loading?: boolean;
  onDisconnect?: (connectorId: string) => Promise<void>;
  onRefresh?: () => void;
  onResync?: (connectorId: string) => Promise<void>;
}

const PROVIDER_LABELS: Record<ConnectorProvider, string> = {
  posthog: "PostHog",
  stripe: "Stripe",
  postgres: "Postgres",
};

function statusBadgeVariant(
  status: ConnectorSummary["status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "connected":
      return "default";
    case "pending":
      return "secondary";
    case "error":
      return "destructive";
    case "disconnected":
      return "outline";
    default:
      return "secondary";
  }
}

function statusLabel(status: ConnectorSummary["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "pending":
      return "Syncing\u2026";
    case "error":
      return "Sync failed";
    case "disconnected":
      return "Disconnected";
    default:
      return status;
  }
}

function formatSyncAge(isoDate: string | null): string {
  if (!isoDate) {
    return "Never synced";
  }

  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function ConnectorStatusPanel({
  connectors,
  loading = false,
  error = null,
  onResync,
  onDisconnect,
  onRefresh,
}: ConnectorStatusPanelProps) {
  const [actionStates, setActionStates] = useState<
    Record<string, "idle" | "working" | "error">
  >({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  async function handleResync(connectorId: string) {
    if (!onResync) {
      return;
    }

    setActionStates((s) => ({ ...s, [connectorId]: "working" }));
    setActionErrors((s) => {
      const next = { ...s };
      delete next[connectorId];
      return next;
    });

    try {
      await onResync(connectorId);
      setActionStates((s) => ({ ...s, [connectorId]: "idle" }));
    } catch (err) {
      setActionStates((s) => ({ ...s, [connectorId]: "error" }));
      setActionErrors((s) => ({
        ...s,
        [connectorId]: err instanceof Error ? err.message : "Resync failed.",
      }));
    }
  }

  async function handleDisconnect(connectorId: string) {
    if (!onDisconnect) {
      return;
    }

    setActionStates((s) => ({ ...s, [connectorId]: "working" }));
    setActionErrors((s) => {
      const next = { ...s };
      delete next[connectorId];
      return next;
    });

    try {
      await onDisconnect(connectorId);
      setActionStates((s) => ({ ...s, [connectorId]: "idle" }));
    } catch (err) {
      setActionStates((s) => ({ ...s, [connectorId]: "error" }));
      setActionErrors((s) => ({
        ...s,
        [connectorId]:
          err instanceof Error ? err.message : "Disconnect failed.",
      }));
    }
  }

  return (
    <Card aria-label="connector status">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Connectors</CardTitle>
        {onRefresh ? (
          <Button disabled={loading} onClick={onRefresh} variant="outline" size="sm">
            {loading ? "Refreshing\u2026" : "Refresh"}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-3">
        {loading && connectors.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading connectors\u2026
          </p>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!(loading || error) && connectors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No connectors configured yet. Connect PostHog or Stripe to start
            syncing data.
          </p>
        ) : null}

        {connectors.map((c) => {
          const providerLabel = PROVIDER_LABELS[c.provider] ?? c.provider;
          const actionState = actionStates[c.id] ?? "idle";
          const actionError = actionErrors[c.id] ?? null;

          return (
            <Card aria-label={`${providerLabel} status`} key={c.id}>
              <CardContent className="grid gap-2 pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{providerLabel}</span>
                  <Badge variant={statusBadgeVariant(c.status)} role="status">
                    {statusLabel(c.status)}
                  </Badge>
                </div>

                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>Last sync: {formatSyncAge(c.lastSyncAt)}</span>
                  {c.lastSyncDurationMs === null ? null : (
                    <span>{String(c.lastSyncDurationMs)}ms</span>
                  )}
                </div>

                {c.lastSyncError ? (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">{c.lastSyncError}</AlertDescription>
                  </Alert>
                ) : null}

                {actionError ? (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">{actionError}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex gap-2">
                  {c.status !== "disconnected" && onResync ? (
                    <Button
                      disabled={actionState === "working"}
                      onClick={() => void handleResync(c.id)}
                      variant="outline"
                      size="sm"
                    >
                      {actionState === "working" ? "Syncing\u2026" : "Resync"}
                    </Button>
                  ) : null}
                  {c.status !== "disconnected" && onDisconnect ? (
                    <Button
                      disabled={actionState === "working"}
                      onClick={() => void handleDisconnect(c.id)}
                      variant="destructive"
                      size="sm"
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/connector-status-panel.tsx
git commit -m "refactor: migrate ConnectorStatusPanel to shadcn/ui"
```

---

## Task 8: Migrate CustomMetricPanel

**Files:**
- Modify: `apps/web/src/components/custom-metric-panel.tsx`

- [ ] **Step 1: Rewrite custom-metric-panel.tsx**

Replace all `<section style={{...}}>` with `<Card>`, status spans with `<Badge>`, alert paragraphs with `<Alert>`, and all inline styles with Tailwind classes.

```tsx
import type { CustomMetricSummary } from "@shared/custom-metric";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface CustomMetricPanelProps {
  customMetric: CustomMetricSummary | null;
  healthError?: boolean;
}

function formatMetricValue(value: number | null, unit: string): string {
  if (value === null) {
    return "\u2014";
  }

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);

  if (unit === "$" || unit === "\u20ac" || unit === "\u00a3") {
    return `${unit}${formatted}`;
  }
  if (unit === "%") {
    return `${formatted}%`;
  }
  return `${formatted} ${unit}`;
}

function computeDelta(
  current: number | null,
  previous: number | null
): string | null {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function CustomMetricPanel({
  customMetric,
  healthError: _healthError = false,
}: CustomMetricPanelProps) {
  if (!customMetric) {
    return (
      <Card
        aria-label="custom metric"
        className="bg-muted"
        data-testid="custom-metric-panel"
      >
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            No custom metric configured. Add a Postgres-backed metric below to
            track additional KPIs.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (customMetric.status === "error") {
    return (
      <Card
        aria-label="custom metric"
        className="border-danger-border bg-danger-bg"
        data-testid="custom-metric-panel"
      >
        <CardContent className="grid gap-2 pt-6">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{customMetric.label}</p>
            <Badge variant="destructive">Sync failed</Badge>
          </div>
          {customMetric.metricValue === null ? (
            <p className="text-sm text-danger">
              No data has been synced yet. Check the Postgres connector
              configuration.
            </p>
          ) : (
            <div data-testid="custom-metric-value">
              <p className="text-sm text-warning">
                Last known:{" "}
                {formatMetricValue(customMetric.metricValue, customMetric.unit)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (customMetric.status === "pending") {
    return (
      <Card
        aria-label="custom metric"
        className="border-warning-border bg-warning-bg"
        data-testid="custom-metric-panel"
      >
        <CardContent className="grid gap-2 pt-6">
          <p className="font-semibold">{customMetric.label}</p>
          <p role="status" className="text-sm text-warning">
            Waiting for the first sync to complete\u2026
          </p>
        </CardContent>
      </Card>
    );
  }

  const delta = computeDelta(
    customMetric.metricValue,
    customMetric.previousValue
  );

  return (
    <Card
      aria-label="custom metric"
      className="border-success-border bg-success-bg"
      data-testid="custom-metric-panel"
    >
      <CardContent className="grid gap-2 pt-6">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{customMetric.label}</p>
          <Badge variant="secondary">Active</Badge>
        </div>
        <div
          className="flex items-baseline gap-2"
          data-testid="custom-metric-value"
        >
          <span className="text-xl font-bold leading-tight">
            {formatMetricValue(customMetric.metricValue, customMetric.unit)}
          </span>
          {delta ? (
            <span
              className={`text-sm font-medium ${delta.startsWith("+") ? "text-success" : "text-danger"}`}
              data-testid="custom-metric-delta"
            >
              {delta}
            </span>
          ) : null}
        </div>
        {customMetric.capturedAt ? (
          <p className="text-xs text-muted-foreground">
            Last captured: {new Date(customMetric.capturedAt).toLocaleString()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/custom-metric-panel.tsx
git commit -m "refactor: migrate CustomMetricPanel to shadcn/ui"
```

---

## Task 9: Migrate StartupMetricsGrid

**Files:**
- Modify: `apps/web/src/components/startup-metrics-grid.tsx`

- [ ] **Step 1: Rewrite startup-metrics-grid.tsx**

Replace each metric `<article style={{...}}>` with `<Card>`. Replace all inline styles with Tailwind classes.

```tsx
import type {
  SupportingMetric,
  SupportingMetricsSnapshot,
} from "@shared/startup-health";
import {
  SUPPORTING_METRIC_LABELS,
  SUPPORTING_METRIC_UNITS,
  SUPPORTING_METRICS,
} from "@shared/startup-health";

import { Card, CardContent } from "@/components/ui/card";

export interface StartupMetricsGridProps {
  metrics: SupportingMetricsSnapshot;
  muted?: boolean;
}

function formatMetricValue(key: SupportingMetric, value: number): string {
  const unit = SUPPORTING_METRIC_UNITS[key];
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "count":
      return new Intl.NumberFormat("en-US").format(value);
    default:
      return String(value);
  }
}

function computeChange(
  current: number,
  previous: number | null
): string | null {
  if (previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.01) {
    return "0%";
  }
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function StartupMetricsGrid({
  metrics,
  muted = false,
}: StartupMetricsGridProps) {
  return (
    <section
      aria-label="supporting metrics"
      className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
    >
      {SUPPORTING_METRICS.map((key) => {
        const metric = metrics[key];
        const change = computeChange(metric.value, metric.previous);

        return (
          <Card aria-label={SUPPORTING_METRIC_LABELS[key]} key={key}>
            <CardContent className="grid gap-1 p-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {SUPPORTING_METRIC_LABELS[key]}
              </span>
              <span
                className={`text-lg font-semibold leading-snug tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}
                data-testid={`metric-${key}`}
              >
                {formatMetricValue(key, metric.value)}
              </span>
              {change ? (
                <span className="text-xs text-muted-foreground">{change}</span>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/startup-metrics-grid.tsx
git commit -m "refactor: migrate StartupMetricsGrid to shadcn/ui"
```

---

## Task 10: Migrate StartupFunnelPanel

**Files:**
- Modify: `apps/web/src/components/startup-funnel-panel.tsx`

- [ ] **Step 1: Rewrite startup-funnel-panel.tsx**

Replace outer `<section>` with `<Card>`, replace raw `<meter>` with `<Progress>`, replace all inline styles with Tailwind classes.

```tsx
import type { FunnelStageRow } from "@shared/startup-health";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export interface StartupFunnelPanelProps {
  muted?: boolean;
  stages: FunnelStageRow[];
}

function formatFunnelValue(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function computeConversion(current: number, previous: number): string | null {
  if (previous === 0) {
    return null;
  }
  const pct = (current / previous) * 100;
  return `${pct.toFixed(1)}%`;
}

function barWidthPct(value: number, maxValue: number): number {
  if (maxValue === 0) {
    return 100;
  }
  return Math.max(4, (value / maxValue) * 100);
}

export function StartupFunnelPanel({
  stages,
  muted = false,
}: StartupFunnelPanelProps) {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const maxValue = sorted[0]?.value ?? 0;

  return (
    <Card aria-label="funnel">
      <CardHeader>
        <CardTitle className="text-sm">Acquisition Funnel</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {sorted.map((stage, idx) => {
          const prev = idx > 0 ? sorted[idx - 1] : null;
          const conversion = prev
            ? computeConversion(stage.value, prev.value)
            : null;

          return (
            <section
              aria-label={stage.label}
              className="grid gap-0.5"
              key={stage.stage}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">
                  {stage.label}
                </span>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-sm font-semibold tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}
                    data-testid={`funnel-${stage.stage}`}
                  >
                    {formatFunnelValue(stage.value)}
                  </span>
                  {conversion ? (
                    <span className="text-xs text-muted-foreground">
                      ({conversion})
                    </span>
                  ) : null}
                </div>
              </div>
              <Progress
                aria-label={`${stage.label} bar`}
                className="h-1.5"
                value={barWidthPct(stage.value, maxValue)}
              />
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/startup-funnel-panel.tsx
git commit -m "refactor: migrate StartupFunnelPanel to shadcn/ui"
```

---

## Task 11: Migrate StartupHealthHero

**Files:**
- Modify: `apps/web/src/components/startup-health-hero.tsx`

- [ ] **Step 1: Rewrite startup-health-hero.tsx**

Replace `<section>` with `<Card>`, status badge with `<Badge>`, all inline styles with Tailwind classes.

```tsx
import type { HealthState, NorthStarMetric } from "@shared/startup-health";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface StartupHealthHeroProps {
  blockedReasons: Array<{ code: string; message: string }>;
  healthState: HealthState;
  lastSnapshotAt: string | null;
  northStarKey: NorthStarMetric;
  northStarPreviousValue: number | null;
  northStarValue: number;
}

const NORTH_STAR_LABELS: Record<NorthStarMetric, string> = {
  mrr: "Monthly Recurring Revenue",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function computeDelta(
  current: number,
  previous: number | null
): { label: string; direction: "up" | "down" | "flat" } | null {
  if (previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.01) {
    return { label: "0%", direction: "flat" };
  }
  const sign = pct > 0 ? "+" : "";
  return {
    label: `${sign}${pct.toFixed(1)}%`,
    direction: pct > 0 ? "up" : "down",
  };
}

function healthBannerConfig(state: HealthState): {
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  cardClass: string;
  text: string;
} {
  switch (state) {
    case "ready":
      return {
        cardClass: "border-success-border bg-success-bg",
        badgeVariant: "default",
        text: "Healthy",
      };
    case "syncing":
      return {
        cardClass: "border-warning-border bg-warning-bg",
        badgeVariant: "secondary",
        text: "Syncing\u2026",
      };
    case "stale":
      return {
        cardClass: "border-warning-border bg-warning-bg",
        badgeVariant: "secondary",
        text: "Stale data",
      };
    case "blocked":
      return {
        cardClass: "border-danger-border bg-danger-bg",
        badgeVariant: "destructive",
        text: "Blocked",
      };
    case "error":
      return {
        cardClass: "border-danger-border bg-danger-bg",
        badgeVariant: "destructive",
        text: "Error",
      };
    default:
      return {
        cardClass: "",
        badgeVariant: "outline",
        text: String(state),
      };
  }
}

function formatSnapshotAge(iso: string | null): string {
  if (!iso) {
    return "No snapshot yet";
  }
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "Updated just now";
  }
  if (minutes < 60) {
    return `Updated ${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Updated ${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `Updated ${String(days)}d ago`;
}

export function StartupHealthHero({
  healthState,
  northStarKey,
  northStarValue,
  northStarPreviousValue,
  lastSnapshotAt,
  blockedReasons,
}: StartupHealthHeroProps) {
  const banner = healthBannerConfig(healthState);
  const delta = computeDelta(northStarValue, northStarPreviousValue);
  const isBlocked = healthState === "blocked" || healthState === "error";

  return (
    <Card aria-label="startup health hero" className={banner.cardClass}>
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center justify-between">
          <Badge variant={banner.badgeVariant} role="status">
            {banner.text}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatSnapshotAge(lastSnapshotAt)}
          </span>
        </div>

        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            {NORTH_STAR_LABELS[northStarKey]}
          </p>
          <p
            className={`mt-1 text-2xl font-bold leading-tight tabular-nums ${isBlocked ? "text-muted-foreground" : "text-foreground"}`}
            data-testid="north-star-value"
          >
            {formatCurrency(northStarValue)}
          </p>
          {delta ? (
            <span
              className={`text-sm font-medium ${
                delta.direction === "up"
                  ? "text-success"
                  : delta.direction === "down"
                    ? "text-danger"
                    : "text-muted-foreground"
              }`}
              data-testid="north-star-delta"
            >
              {delta.label} from previous
            </span>
          ) : null}
        </div>

        {blockedReasons.length > 0 ? (
          <div aria-label="blocked reasons" className="grid gap-1" role="alert">
            {blockedReasons.map((reason) => (
              <p className="text-sm text-danger" key={reason.code}>
                {reason.message}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/startup-health-hero.tsx
git commit -m "refactor: migrate StartupHealthHero to shadcn/ui"
```

---

## Task 12: Migrate StartupTaskList

**Files:**
- Modify: `apps/web/src/components/startup-task-list.tsx`

- [ ] **Step 1: Rewrite startup-task-list.tsx**

Replace outer `<section>` with `<Card>`, sync badge spans with `<Badge>`, buttons with `<Button>`, alerts with `<Alert>`.

```tsx
import type {
  InternalTaskPayload,
  TaskSyncStatus,
} from "@shared/internal-task";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface StartupTaskListProps {
  error: string | null;
  onRetry?: () => void;
  status: "idle" | "loading" | "ready" | "error";
  tasks: InternalTaskPayload[];
}

const SYNC_LABELS: Record<TaskSyncStatus, string> = {
  not_synced: "Pending",
  queued: "Queued",
  syncing: "Syncing\u2026",
  synced: "Synced",
  failed: "Failed",
};

function syncBadgeVariant(
  status: TaskSyncStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "synced":
      return "default";
    case "queued":
    case "syncing":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function TaskSyncBadge({ status }: { status: TaskSyncStatus }) {
  return (
    <Badge
      data-testid="task-sync-status"
      variant={syncBadgeVariant(status)}
    >
      {SYNC_LABELS[status] ?? status}
    </Badge>
  );
}

function TaskRow({ task }: { task: InternalTaskPayload }) {
  return (
    <li
      className="grid gap-1 border-b border-muted py-3"
      data-testid="task-row"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{task.title}</span>
        <TaskSyncBadge status={task.syncStatus} />
      </div>
      <p className="text-sm text-muted-foreground">{task.description}</p>
      {task.linkedMetricKeys.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Linked metrics: {task.linkedMetricKeys.join(", ")}
        </p>
      ) : null}
      {task.linearIssueId ? (
        <p className="text-xs text-info" data-testid="task-linear-id">
          Linear: {task.linearIssueId}
        </p>
      ) : null}
      {task.lastSyncError ? (
        <p
          className="text-xs text-danger"
          data-testid="task-sync-error"
          role="alert"
        >
          Sync error: {task.lastSyncError}
        </p>
      ) : null}
    </li>
  );
}

export function StartupTaskList({
  tasks,
  status,
  error,
  onRetry,
}: StartupTaskListProps) {
  if (status === "idle" && tasks.length === 0) {
    return null;
  }

  return (
    <Card aria-label="startup tasks" data-testid="startup-task-list">
      <CardContent className="grid gap-2 pt-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Tasks
        </p>

        {status === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading tasks\u2026
          </p>
        ) : null}

        {status === "error" ? (
          <div className="grid gap-1.5">
            <Alert variant="destructive">
              <AlertDescription>{error ?? "Failed to load tasks."}</AlertDescription>
            </Alert>
            {onRetry ? (
              <Button onClick={onRetry} variant="outline" size="sm">
                Retry task load
              </Button>
            ) : null}
          </div>
        ) : null}

        {(status === "ready" || status === "loading") &&
        tasks.length === 0 &&
        status !== "loading" ? (
          <p className="text-sm text-muted-foreground" data-testid="no-tasks">
            No tasks yet. Create one from an insight action above.
          </p>
        ) : null}

        {tasks.length > 0 ? (
          <ul className="m-0 list-none p-0" data-testid="task-rows">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/startup-task-list.tsx
git commit -m "refactor: migrate StartupTaskList to shadcn/ui"
```

---

## Task 13: Migrate StartupInsightCard

**Files:**
- Modify: `apps/web/src/components/startup-insight-card.tsx`

This is the largest component. The migration replaces all `<section style={{...}}>` with `<Card>` variants, `<button style={{...}}>` with `<Button>`, badge spans with `<Badge>`, alerts with `<Alert>`.

- [ ] **Step 1: Rewrite startup-insight-card.tsx**

Keep all the sub-components (EvidenceBullets, ExplanationSection, SyncStatusBadge, ActionList) but migrate them from inline styles to shadcn/ui + Tailwind classes.

```tsx
import type { InternalTaskPayload } from "@shared/internal-task";
import type {
  InsightAction,
  InsightExplanation,
  LatestInsightPayload,
} from "@shared/startup-insight";
import { INSIGHT_CONDITION_LABELS } from "@shared/startup-insight";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import type { InsightDisplayStatus } from "./startup-insight-card-types";

export type { InsightDisplayStatus };

export interface StartupInsightCardProps {
  creatingActionIndex?: number | null;
  diagnosticMessage: string | null;
  displayStatus: InsightDisplayStatus;
  insight: LatestInsightPayload | null;
  onCreateTask?: (actionIndex: number) => void;
  onRetry?: () => void;
  taskCreateError?: string | null;
  tasks?: InternalTaskPayload[];
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value
  );
}

function EvidenceBullets({ insight }: { insight: LatestInsightPayload }) {
  const items = insight.evidence.items;
  if (items.length === 0) {
    return null;
  }

  return (
    <ul
      className="my-2 list-disc pl-5"
      data-testid="insight-evidence"
    >
      {items.map((item) => (
        <li
          className="mb-1 text-sm"
          key={`${item.metricKey}-${item.label}`}
        >
          <strong>{item.label}:</strong> {formatMetricValue(item.currentValue)}
          {item.previousValue === null ? null : (
            <span
              className={
                item.direction === "down"
                  ? "text-danger"
                  : item.direction === "up"
                    ? "text-success"
                    : "text-muted-foreground"
              }
            >
              {" "}
              ({item.direction === "down"
                ? "\u2193"
                : item.direction === "up"
                  ? "\u2191"
                  : "\u2192"}{" "}
              from {formatMetricValue(item.previousValue)})
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ExplanationSection({
  explanation,
}: {
  explanation: InsightExplanation;
}) {
  return (
    <div className="grid gap-3">
      <div data-testid="insight-observation">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Observation
        </p>
        <p className="mt-1">{explanation.observation}</p>
      </div>
      <div data-testid="insight-hypothesis">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Hypothesis
        </p>
        <p className="mt-1">{explanation.hypothesis}</p>
      </div>
    </div>
  );
}

function SyncStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    not_synced: "Not synced",
    queued: "Queued",
    syncing: "Syncing\u2026",
    synced: "Synced to Linear",
    failed: "Sync failed",
  };

  const variant = (() => {
    switch (status) {
      case "synced":
        return "default" as const;
      case "queued":
      case "syncing":
        return "secondary" as const;
      case "failed":
        return "destructive" as const;
      default:
        return "outline" as const;
    }
  })();

  return (
    <Badge data-testid="task-sync-badge" variant={variant}>
      {labels[status] ?? status}
    </Badge>
  );
}

interface ActionListProps {
  actions: InsightAction[];
  creatingActionIndex?: number | null;
  onCreateTask?: (actionIndex: number) => void;
  sourceInsightId?: string;
  taskCreateError?: string | null;
  tasks?: InternalTaskPayload[];
}

function ActionList({
  actions,
  tasks = [],
  creatingActionIndex = null,
  taskCreateError = null,
  onCreateTask,
  sourceInsightId,
}: ActionListProps) {
  const taskByActionIndex = new Map<number, InternalTaskPayload>();
  for (const t of tasks) {
    if (!sourceInsightId || t.sourceInsightId === sourceInsightId) {
      taskByActionIndex.set(t.sourceActionIndex, t);
    }
  }

  return (
    <div data-testid="insight-actions">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        Recommended Actions
      </p>
      <ol className="m-0 pl-5">
        {actions.map((action, i) => {
          const existingTask = taskByActionIndex.get(i);
          const isCreating = creatingActionIndex === i;

          return (
            <li className="mb-3" key={`action-${action.label}`}>
              <strong>{action.label}</strong>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {action.rationale}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                {existingTask ? (
                  <>
                    <span
                      className="text-sm font-medium text-success"
                      data-testid={`action-${i}-task-created`}
                    >
                      \u2713 Task created
                    </span>
                    <SyncStatusBadge status={existingTask.syncStatus} />
                    {existingTask.linearIssueId ? (
                      <span
                        className="text-xs text-info"
                        data-testid={`action-${i}-linear-link`}
                      >
                        Linear: {existingTask.linearIssueId}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <Button
                    data-testid={`action-${i}-create-task`}
                    disabled={isCreating}
                    onClick={() => onCreateTask?.(i)}
                    size="sm"
                    variant="outline"
                  >
                    {isCreating ? "Creating\u2026" : "Create task"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {taskCreateError ? (
        <p
          className="mt-1 text-xs text-danger"
          data-testid="task-create-error"
          role="alert"
        >
          {taskCreateError}
        </p>
      ) : null}
    </div>
  );
}

function InsightShell({
  borderClass,
  children,
}: {
  borderClass: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      aria-label="startup insight"
      className={borderClass}
      data-testid="startup-insight-card"
    >
      <CardContent className="grid gap-3 pt-5">
        {children}
      </CardContent>
    </Card>
  );
}

export function StartupInsightCard({
  insight,
  displayStatus,
  diagnosticMessage,
  onRetry,
  tasks = [],
  creatingActionIndex = null,
  taskCreateError = null,
  onCreateTask,
}: StartupInsightCardProps) {
  if (displayStatus === "unavailable") {
    return (
      <InsightShell borderClass="bg-muted">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Insight
        </p>
        <p className="text-muted-foreground" data-testid="insight-unavailable">
          {diagnosticMessage ??
            "No insight yet. Insights appear after the first data sync."}
        </p>
      </InsightShell>
    );
  }

  if (displayStatus === "blocked") {
    return (
      <InsightShell borderClass="border-warning-border bg-warning-bg">
        <p className="text-xs uppercase tracking-wider text-warning">Insight</p>
        <p
          className="text-warning"
          data-testid="insight-blocked"
          role="status"
        >
          {diagnosticMessage ??
            "Insights are paused until all connectors are healthy."}
        </p>
      </InsightShell>
    );
  }

  if (displayStatus === "error") {
    return (
      <InsightShell borderClass="border-danger-border bg-danger-bg">
        <p className="text-xs uppercase tracking-wider text-danger">Insight</p>
        <p className="text-danger" data-testid="insight-error" role="alert">
          {diagnosticMessage ??
            "Could not generate insight. Try again or check your connectors."}
        </p>
        {onRetry ? (
          <Button onClick={onRetry} variant="outline" className="justify-self-start">
            Try again
          </Button>
        ) : null}
      </InsightShell>
    );
  }

  if (!insight?.explanation) {
    return (
      <InsightShell borderClass="bg-muted">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Insight
        </p>
        <p className="text-muted-foreground" data-testid="insight-unavailable">
          No insight yet. Insights appear after the first data sync.
        </p>
      </InsightShell>
    );
  }

  const conditionLabel =
    INSIGHT_CONDITION_LABELS[insight.conditionCode] ?? insight.conditionCode;

  return (
    <InsightShell borderClass="border-info-border bg-info-bg">
      <div>
        <p className="text-xs uppercase tracking-wider text-info">Insight</p>
        <p
          className="mt-1 font-semibold text-info"
          data-testid="insight-condition"
        >
          {conditionLabel}
        </p>
      </div>

      <EvidenceBullets insight={insight} />
      <ExplanationSection explanation={insight.explanation} />

      <ActionList
        actions={insight.explanation.actions}
        creatingActionIndex={creatingActionIndex}
        onCreateTask={onCreateTask}
        taskCreateError={taskCreateError}
        tasks={tasks}
      />

      {diagnosticMessage ? (
        <p
          className="text-sm italic text-warning"
          data-testid="insight-diagnostic"
        >
          {diagnosticMessage}
        </p>
      ) : null}
    </InsightShell>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/startup-insight-card.tsx
git commit -m "refactor: migrate StartupInsightCard to shadcn/ui"
```

---

## Task 14: Migrate PortfolioStartupCard

**Files:**
- Modify: `apps/web/src/components/portfolio-startup-card.tsx`

- [ ] **Step 1: Rewrite portfolio-startup-card.tsx**

Replace `<section>` with `<Card>`, badge `<span>` with `<Badge>`, all inline styles with Tailwind.

```tsx
import type {
  PortfolioBadge,
  PortfolioCardViewModel,
} from "../lib/portfolio-card";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

function badgeVariant(
  badge: PortfolioBadge
): "default" | "secondary" | "destructive" | "outline" {
  switch (badge) {
    case "healthy":
      return "default";
    case "attention":
    case "syncing":
      return "secondary";
    case "blocked":
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

export interface PortfolioStartupCardProps {
  viewModel: PortfolioCardViewModel;
}

export function PortfolioStartupCard({ viewModel }: PortfolioStartupCardProps) {
  return (
    <Card
      aria-label="portfolio startup card"
      data-testid="portfolio-startup-card"
    >
      <CardContent className="grid gap-3 pt-5">
        {/* Header row: name + badge */}
        <div className="flex items-center justify-between">
          <h3
            className="text-lg font-semibold"
            data-testid="portfolio-startup-name"
          >
            {viewModel.name}
          </h3>
          <Badge
            data-testid="portfolio-badge"
            role="status"
            variant={badgeVariant(viewModel.badge)}
          >
            {viewModel.badgeLabel}
          </Badge>
        </div>

        {/* Metrics row: north-star value + trend */}
        <div className="flex items-baseline gap-3">
          <span
            className={`text-xl font-bold leading-tight tabular-nums ${
              viewModel.badge === "blocked" || viewModel.badge === "error"
                ? "text-muted-foreground"
                : "text-foreground"
            }`}
            data-testid="portfolio-north-star"
          >
            {viewModel.northStarDisplay}
          </span>
          {viewModel.trendSummary ? (
            <span
              className={`text-sm font-medium ${
                viewModel.trendSummary.includes("+")
                  ? "text-success"
                  : viewModel.trendSummary.includes("-")
                    ? "text-danger"
                    : "text-muted-foreground"
              }`}
              data-testid="portfolio-trend"
            >
              {viewModel.trendSummary}
            </span>
          ) : null}
        </div>

        {/* Bottom row: freshness + top issue */}
        <div className="flex items-center justify-between gap-4">
          <span
            className="text-xs text-muted-foreground"
            data-testid="portfolio-freshness"
          >
            {viewModel.freshnessCopy}
          </span>
          <span
            className="max-w-[60%] text-right text-sm text-muted-foreground"
            data-testid="portfolio-top-issue"
          >
            {viewModel.topIssue}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/portfolio-startup-card.tsx
git commit -m "refactor: migrate PortfolioStartupCard to shadcn/ui"
```

---

## Task 15: Migrate AppShell

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`

- [ ] **Step 1: Rewrite app-shell.tsx**

Replace:
- Error `<section>` → `<Card>` with `<Alert>`
- Dashboard content `<section>` → `<Card>`
- `<button>` → `<Button>`
- All inline styles → Tailwind classes
- Keep `<header>` with gradient background via Tailwind classes

```tsx
import type { StartupRecord, WorkspaceSummary } from "@shared/types";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { StartupList } from "./startup-list";
import { WorkspaceSwitcher } from "./workspace-switcher";

export interface AppShellProps {
  activeWorkspaceId: string | null;
  children?: ReactNode;
  isSwitchingWorkspace?: boolean;
  onActivateWorkspace?: (workspaceId: string) => void | Promise<void>;
  onRetryShell?: () => void | Promise<void>;
  onRetryStartups?: () => void | Promise<void>;
  shellError?: string | null;
  shellStatus: "loading" | "ready" | "error";
  startupError?: string | null;
  startupStatus: "idle" | "loading" | "refreshing" | "ready" | "error";
  startups: StartupRecord[];
  user: {
    email: string;
    name?: string | null;
  };
  workspaceError?: string | null;
  workspaces: WorkspaceSummary[];
}

export function AppShell({
  user,
  workspaces,
  activeWorkspaceId,
  startups,
  shellStatus,
  startupStatus,
  shellError = null,
  workspaceError = null,
  startupError = null,
  isSwitchingWorkspace = false,
  onRetryShell,
  onRetryStartups,
  onActivateWorkspace,
  children,
}: AppShellProps) {
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  return (
    <main aria-label="dashboard shell" className="grid gap-6 bg-background p-6">
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-[oklch(0.18_0.015_270)] to-[oklch(0.25_0.02_265)] text-[oklch(0.97_0.005_80)]">
        <CardContent className="grid gap-2 pt-6">
          <p className="text-sm uppercase tracking-wider text-[oklch(0.78_0.02_270)]">
            Founder dashboard
          </p>
          <h1 className="text-xl leading-tight">Portfolio overview</h1>
          <p className="text-[oklch(0.88_0.008_80)]">
            {user.name ? `${user.name} (${user.email})` : user.email} — prioritize
            and monitor your startups from one surface.
          </p>
        </CardContent>
      </Card>

      {shellStatus === "loading" ? (
        <p role="status" className="text-muted-foreground">Loading your dashboard\u2026</p>
      ) : null}

      {shellStatus === "error" ? (
        <Card className="border-danger-border bg-danger-bg">
          <CardContent className="grid gap-3 pt-6">
            <Alert variant="destructive">
              <AlertDescription>
                {shellError ?? "The dashboard could not be loaded."}
              </AlertDescription>
            </Alert>
            <Button onClick={() => void onRetryShell?.()} variant="outline">
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="grid content-start gap-4">
          <WorkspaceSwitcher
            activeWorkspaceId={activeWorkspaceId}
            error={workspaceError}
            isLoading={shellStatus === "loading"}
            isSwitching={isSwitchingWorkspace}
            onActivateWorkspace={onActivateWorkspace}
            startupCount={startups.length}
            workspaces={workspaces}
          />
          <StartupList
            error={startupError}
            onRetry={onRetryStartups}
            startups={startups}
            status={startupStatus}
            workspaceName={activeWorkspace?.name ?? null}
          />
        </aside>

        <Card aria-label="dashboard content">
          <CardContent className="grid gap-4 pt-5">
            {children ?? (
              <>
                <h2>Workspace overview</h2>
                <p className="text-muted-foreground">
                  Select a startup to view health metrics, insights, and tasks.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/app-shell.tsx
git commit -m "refactor: migrate AppShell to shadcn/ui"
```

---

## Task 16: Migrate Root Layout

**Files:**
- Modify: `apps/web/src/routes/__root.tsx`

- [ ] **Step 1: Rewrite __root.tsx**

Replace:
- Header with hardcoded hex colors → Tailwind classes using CSS variables
- Auth status bar with hex colors → `<Alert>` or Tailwind classes
- `<div style={{borderBottom}}>` → `border-b border-border`

```tsx
import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";

import {
  type AuthController,
  describeSessionState,
  useAuthBootstrap,
  useAuthSnapshot,
} from "../lib/auth-client";

import { Separator } from "@/components/ui/separator";

export interface AppRouterContext {
  auth: AuthController;
}

export const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const { auth } = rootRoute.useRouteContext();
  const bootstrapSnapshot = useAuthBootstrap(auth);
  const liveSnapshot = useAuthSnapshot(auth);
  const snapshot =
    liveSnapshot.status === "idle" ? bootstrapSnapshot : liveSnapshot;

  return (
    <div className="min-h-screen" data-auth-state={snapshot.status}>
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Founder Control Plane
          </p>
          <strong>Portfolio Dashboard</strong>
        </div>
        <nav>
          <Link
            className="text-sm text-primary underline-offset-4 hover:underline"
            to="/auth/sign-in"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <div
        aria-live="polite"
        className={`px-6 py-3 border-b border-border text-sm ${
          snapshot.status === "error"
            ? "bg-danger-bg text-danger"
            : "bg-muted text-muted-foreground"
        }`}
        data-auth-diagnostic={snapshot.diagnostic}
        role="status"
      >
        {describeSessionState(snapshot)}
      </div>

      <Outlet />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/__root.tsx
git commit -m "refactor: migrate root layout to shadcn/ui"
```

---

## Task 17: Migrate AuthPendingShell

**Files:**
- Modify: `apps/web/src/routes/_authenticated.tsx`

- [ ] **Step 1: Rewrite _authenticated.tsx**

Replace inline styles with Tailwind classes.

```tsx
import { createRoute, Outlet, redirect } from "@tanstack/react-router";

import { buildProtectedRedirectTarget } from "../lib/auth-client";
import { rootRoute } from "./__root";

export const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authenticated",
  pendingMs: 0,
  pendingComponent: AuthPendingShell,
  beforeLoad: async ({ context, location }) => {
    const authState = await context.auth.bootstrapSession();

    if (authState.status !== "authenticated") {
      throw redirect({
        to: "/auth/sign-in",
        search: {
          redirect: buildProtectedRedirectTarget(location.pathname),
        },
      });
    }

    return {
      authState,
    };
  },
  component: AuthenticatedLayout,
});

export function AuthPendingShell() {
  return (
    <main aria-label="auth bootstrap" className="p-6">
      <h1 className="text-xl font-bold">Signing you in\u2026</h1>
      <p className="mt-2 text-muted-foreground">
        Verifying your session before loading the dashboard.
      </p>
    </main>
  );
}

export function AuthenticatedLayout() {
  return <Outlet />;
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_authenticated.tsx
git commit -m "refactor: migrate AuthPendingShell to Tailwind classes"
```

---

## Task 18: Migrate SignInPage

**Files:**
- Modify: `apps/web/src/routes/auth/sign-in.tsx`

- [ ] **Step 1: Rewrite sign-in.tsx**

Replace:
- `<main style={{...}}>` → `<main className="...">`
- `<input>` → `<Input>`
- `<button>` → `<Button>`
- `<label>` → `<Label>`
- `<p role="alert">` → `<Alert variant="destructive">`
- `<p role="status">` → `<Alert>`
- All inline styles → Tailwind classes

```tsx
import { createRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import {
  type AuthController,
  type AuthSnapshot,
  DEFAULT_AUTH_REDIRECT_PATH,
  getErrorMessage,
  normalizePostAuthRedirect,
  useAuthSnapshot,
} from "../../lib/auth-client";
import { rootRoute } from "../__root";

export interface SignInSearch {
  error?: string;
  redirect?: string;
}

export interface SignInPageProps {
  auth: AuthController;
  navigateTo?: (to: string) => void;
  search?: SignInSearch;
}

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "auth/sign-in",
  validateSearch: (search): SignInSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: SignInRouteComponent,
});

function SignInRouteComponent() {
  const { auth } = rootRoute.useRouteContext();
  const search = signInRoute.useSearch();
  const navigate = useNavigate();

  return (
    <SignInPage
      auth={auth}
      navigateTo={(to) => {
        void navigate({ to: to as "/app" | "/auth/sign-in" });
      }}
      search={search}
    />
  );
}

function getCallbackErrorMessage(errorCode: string | undefined) {
  switch (errorCode) {
    case "INVALID_TOKEN":
      return "Your magic link is invalid or has already been used.";
    case "EXPIRED_TOKEN":
      return "Your magic link expired. Request a new one to continue.";
    case "ATTEMPTS_EXCEEDED":
      return "That magic link can no longer be used. Request another one.";
    default:
      return errorCode
        ? "Sign-in could not be completed. Please try again."
        : null;
  }
}

function SessionStateNotice({ snapshot }: { snapshot: AuthSnapshot }) {
  if (snapshot.status === "loading") {
    return (
      <Alert>
        <AlertDescription role="status">Checking your session\u2026</AlertDescription>
      </Alert>
    );
  }

  if (snapshot.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {snapshot.error?.message ?? "Sign-in is temporarily unavailable."}
        </AlertDescription>
      </Alert>
    );
  }

  if (snapshot.status === "authenticated") {
    return (
      <Alert>
        <AlertDescription role="status">
          You're signed in. Redirecting to your dashboard\u2026
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertDescription role="status">Sign in to continue.</AlertDescription>
    </Alert>
  );
}

export function SignInPage({ auth, search, navigateTo }: SignInPageProps) {
  const snapshot = useAuthSnapshot(auth);
  const [email, setEmail] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "google" | "magic-link" | null
  >(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);
  const [isRetryingSession, setIsRetryingSession] = useState(false);

  const redirectTo = useMemo(
    () => normalizePostAuthRedirect(search?.redirect),
    [search?.redirect]
  );
  const callbackErrorMessage = useMemo(
    () => getCallbackErrorMessage(search?.error),
    [search?.error]
  );

  useEffect(() => {
    if (snapshot.status === "idle") {
      void auth.bootstrapSession();
    }
  }, [auth, snapshot.status]);

  useEffect(() => {
    if (snapshot.status === "authenticated") {
      navigateTo?.(redirectTo);
    }
  }, [navigateTo, redirectTo, snapshot.status]);

  async function handleGoogleSignIn() {
    setInlineError(null);
    setMagicLinkSentTo(null);
    setPendingAction("google");

    try {
      await auth.signInWithGoogle({ redirectTo });
    } catch (error) {
      setInlineError(
        getErrorMessage(error, "Google sign-in could not be started.")
      );
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
      setInlineError("Enter your email address to receive a magic link.");
      return;
    }

    setPendingAction("magic-link");

    try {
      await auth.signInWithMagicLink({
        email: trimmedEmail,
        redirectTo,
      });
      setMagicLinkSentTo(trimmedEmail);
    } catch (error) {
      setInlineError(
        getErrorMessage(error, "Magic-link sign-in could not be started.")
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main aria-label="sign-in page" className="mx-auto max-w-lg px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in to your dashboard</CardTitle>
          <CardDescription>
            Use Google or a magic link to access your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SessionStateNotice snapshot={snapshot} />

          {snapshot.status === "error" ? (
            <Button
              disabled={isRetryingSession}
              onClick={() => void handleRetrySession()}
              variant="outline"
            >
              {isRetryingSession
                ? "Retrying session check\u2026"
                : "Retry session check"}
            </Button>
          ) : null}

          {callbackErrorMessage ? (
            <Alert variant="destructive">
              <AlertDescription>{callbackErrorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {inlineError ? (
            <Alert variant="destructive">
              <AlertDescription>{inlineError}</AlertDescription>
            </Alert>
          ) : null}

          {magicLinkSentTo ? (
            <Alert>
              <AlertDescription role="status">
                Magic link requested for {magicLinkSentTo}.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            className="w-full"
            disabled={pendingAction !== null}
            onClick={handleGoogleSignIn}
            variant="outline"
          >
            {pendingAction === "google"
              ? "Starting Google sign-in\u2026"
              : "Continue with Google"}
          </Button>

          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <form onSubmit={handleMagicLinkSubmit} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="magic-link-email">Work email</Label>
              <Input
                autoComplete="email"
                id="magic-link-email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="founder@startup.com"
                type="email"
                value={email}
              />
            </div>
            <Button disabled={pendingAction !== null} type="submit">
              {pendingAction === "magic-link"
                ? "Sending magic link\u2026"
                : "Send magic link"}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground">
            You'll be redirected to{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {redirectTo || DEFAULT_AUTH_REDIRECT_PATH}
            </code>{" "}
            after signing in.
          </p>
          <a
            className="text-sm text-primary underline-offset-4 hover:underline"
            href="/app"
          >
            Go to the dashboard
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/auth/sign-in.tsx
git commit -m "refactor: migrate SignInPage to shadcn/ui"
```

---

## Task 19: Final Verification

- [ ] **Step 1: Run full build**

```bash
cd apps/web && bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run lint check**

```bash
cd /Users/belyaev-dev/WebstormProjects/dashboard && pnpm dlx ultracite check
```

Fix any lint issues found.

- [ ] **Step 3: Verify no raw HTML patterns remain**

Search for remaining inline `style=` in component files:

```bash
grep -rn 'style={{' apps/web/src/components/ apps/web/src/routes/
```

Expected: No matches. If any remain, fix them.

- [ ] **Step 4: Verify no raw `<button>` or `<input>` remain**

```bash
grep -rn '<button\b' apps/web/src/components/ apps/web/src/routes/
grep -rn '<input\b' apps/web/src/components/ apps/web/src/routes/
grep -rn '<select\b' apps/web/src/components/ apps/web/src/routes/
```

Expected: No matches (all replaced with shadcn components).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining lint and style issues from shadcn migration"
```
