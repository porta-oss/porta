import type { EventType } from "@shared/event-log";
import { EVENT_TYPES } from "@shared/event-log";
import type { WebhookConfigSummary } from "@shared/webhook";
import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

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
import { Separator } from "@/components/ui/separator";
import { API_BASE_URL, type AuthSnapshot } from "@/lib/auth-client";
import { authenticatedRoute } from "../../_authenticated";

// ------------------------------------------------------------------
// Route definition
// ------------------------------------------------------------------

export const webhookSettingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "app/settings/webhooks",
  component: WebhookSettingsRouteComponent,
});

function WebhookSettingsRouteComponent() {
  const authState = webhookSettingsRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot,
  });

  return <WebhookSettingsPage authState={authState} />;
}

// ------------------------------------------------------------------
// API helpers
// ------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 8000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error("Request timed out")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (handle) {
      clearTimeout(handle);
    }
  }
}

async function apiRequest(path: string, init?: RequestInit): Promise<unknown> {
  const normalizedPath = path.replace(/^\//, "");
  const response = await withTimeout(
    fetch(new URL(normalizedPath, `${API_BASE_URL}/`).toString(), {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const payload: unknown = await response.json();

  if (!response.ok) {
    const message =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Request failed";
    throw new Error(message);
  }

  return payload;
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface EventLogEntry {
  createdAt: string;
  eventType: string;
  id: string;
  payload: Record<string, unknown>;
}

// Subscribable event types (exclude internal webhook.delivered/webhook.failed)
const SUBSCRIBABLE_EVENT_TYPES = EVENT_TYPES.filter(
  (et) => et !== "webhook.delivered" && et !== "webhook.failed"
);

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

function SecretBanner({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="mb-4 border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
      <CardContent className="pt-5">
        <p className="mb-2 font-medium text-sm">
          Webhook signing secret (shown once):
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
            {secret}
          </code>
          <Button onClick={copy} size="sm" variant="outline">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          Store this secret securely. It will not be shown again.
        </p>
      </CardContent>
    </Card>
  );
}

function EventTypeSelector({
  selected,
  onToggle,
}: {
  onToggle: (et: EventType) => void;
  selected: Set<EventType>;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="font-medium text-sm">Event types</legend>
      <p className="text-muted-foreground text-xs">
        Select which events trigger webhook delivery.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SUBSCRIBABLE_EVENT_TYPES.map((et) => (
          <label
            className="flex cursor-pointer items-center gap-2 rounded border border-input px-2.5 py-1.5 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            key={et}
          >
            <input
              checked={selected.has(et)}
              className="accent-primary"
              onChange={() => onToggle(et)}
              type="checkbox"
            />
            <span className="truncate">{et}</span>
          </label>
        ))}
      </div>
      {selected.size === 0 && (
        <p className="text-muted-foreground text-xs">
          Select at least one event type.
        </p>
      )}
    </fieldset>
  );
}

function DeliveryLog({
  entries,
  loading,
}: {
  entries: EventLogEntry[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery Log</CardTitle>
        <CardDescription>Recent webhook delivery attempts.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <p className="text-muted-foreground text-sm" role="status">
            Loading delivery log...
          </p>
        )}
        {!loading && entries.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No delivery attempts yet.
          </p>
        )}
        {!loading && entries.length > 0 && (
          <div className="grid gap-2">
            {entries.map((entry) => (
              <DeliveryLogRow entry={entry} key={entry.id} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryLogRow({ entry }: { entry: EventLogEntry }) {
  const delivered = entry.eventType === "webhook.delivered";
  return (
    <div className="flex items-center justify-between rounded border border-input px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant={delivered ? "default" : "destructive"}>
          {delivered ? "Delivered" : "Failed"}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {typeof entry.payload.eventType === "string"
            ? entry.payload.eventType
            : "\u2014"}
        </span>
      </div>
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        {delivered && typeof entry.payload.statusCode === "number" && (
          <span>HTTP {entry.payload.statusCode}</span>
        )}
        {!delivered && typeof entry.payload.error === "string" && (
          <span className="max-w-48 truncate" title={entry.payload.error}>
            {entry.payload.error}
          </span>
        )}
        <time dateTime={entry.createdAt}>
          {new Date(entry.createdAt).toLocaleString()}
        </time>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Main page component
// ------------------------------------------------------------------

interface WebhookSettingsPageProps {
  authState: AuthSnapshot;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: settings page with form state, validation, and CRUD — tightly coupled by design
export function WebhookSettingsPage({ authState }: WebhookSettingsPageProps) {
  const [startups, setStartups] = useState<{ id: string; name: string }[]>([]);
  const [selectedStartupId, setSelectedStartupId] = useState<string | null>(
    null
  );
  const [webhook, setWebhook] = useState<WebhookConfigSummary | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deliveryLog, setDeliveryLog] = useState<EventLogEntry[]>([]);
  const [deliveryLogLoading, setDeliveryLogLoading] = useState(false);

  // Form state
  const [urlInput, setUrlInput] = useState("");
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<EventType>>(
    new Set()
  );

  // Load startups
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const payload = await apiRequest("/startups");
        if (cancelled) {
          return;
        }
        if (isRecord(payload) && Array.isArray(payload.startups)) {
          const parsed = payload.startups.filter(isRecord).map((s) => ({
            id: String(s.id),
            name: typeof s.name === "string" ? s.name : String(s.id),
          }));
          setStartups(parsed);
          setSelectedStartupId(
            (prev) => prev ?? (parsed.length > 0 ? parsed[0].id : null)
          );
        }
      } catch {
        // Non-critical
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load webhook config
  const loadWebhookConfig = useCallback(async (startupId: string) => {
    setLoading(true);
    setError(null);
    setCreatedSecret(null);
    setDeleteConfirm(false);
    try {
      const payload = await apiRequest(`/startups/${startupId}/webhook`);
      if (isRecord(payload) && isRecord(payload.webhook)) {
        const w = payload.webhook as unknown as WebhookConfigSummary;
        setWebhook(w);
        setUrlInput(w.url);
        setSelectedEventTypes(new Set(w.eventTypes));
      } else {
        setWebhook(null);
        setUrlInput("");
        setSelectedEventTypes(new Set());
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load webhook config"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStartupId) {
      void loadWebhookConfig(selectedStartupId);
    }
  }, [selectedStartupId, loadWebhookConfig]);

  // Load delivery log
  const loadDeliveryLog = useCallback(async (startupId: string) => {
    setDeliveryLogLoading(true);
    try {
      const payload = await apiRequest(
        `/events?startupId=${startupId}&eventTypes=webhook.delivered,webhook.failed&limit=20`
      );
      if (isRecord(payload) && Array.isArray(payload.events)) {
        setDeliveryLog(
          payload.events.filter(isRecord).map((e) => ({
            id: String(e.id),
            eventType: String(e.eventType),
            createdAt: String(e.createdAt),
            payload: isRecord(e.payload)
              ? (e.payload as Record<string, unknown>)
              : {},
          }))
        );
      }
    } catch {
      // Non-critical
    } finally {
      setDeliveryLogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStartupId && webhook) {
      void loadDeliveryLog(selectedStartupId);
    } else {
      setDeliveryLog([]);
    }
  }, [selectedStartupId, webhook, loadDeliveryLog]);

  // Handlers
  const urlValid = urlInput.startsWith("https://") && urlInput.length > 10;
  const formValid = urlValid && selectedEventTypes.size > 0;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook save with create/update branching and error handling
  async function handleSave() {
    if (!(selectedStartupId && formValid)) {
      return;
    }
    setSaving(true);
    setError(null);
    const method = webhook ? "PATCH" : "POST";
    try {
      const payload = await apiRequest(
        `/startups/${selectedStartupId}/webhook`,
        {
          method,
          body: JSON.stringify({
            url: urlInput,
            eventTypes: [...selectedEventTypes],
          }),
        }
      );
      if (isRecord(payload)) {
        if (isRecord(payload.webhook)) {
          setWebhook(payload.webhook as unknown as WebhookConfigSummary);
        }
        if (typeof payload.secret === "string") {
          setCreatedSecret(payload.secret);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${webhook ? "update" : "create"} webhook`
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedStartupId) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/startups/${selectedStartupId}/webhook`, {
        method: "DELETE",
      });
      setWebhook(null);
      setUrlInput("");
      setSelectedEventTypes(new Set());
      setCreatedSecret(null);
      setDeleteConfirm(false);
      setDeliveryLog([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete webhook");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetCircuitBreaker() {
    if (!selectedStartupId) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = await apiRequest(
        `/startups/${selectedStartupId}/webhook`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: true }),
        }
      );
      if (isRecord(payload) && isRecord(payload.webhook)) {
        setWebhook(payload.webhook as unknown as WebhookConfigSummary);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reset circuit breaker"
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleEventType(et: EventType) {
    setSelectedEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(et)) {
        next.delete(et);
      } else {
        next.add(et);
      }
      return next;
    });
  }

  const selectedStartupName =
    startups.find((s) => s.id === selectedStartupId)?.name ?? "Select startup";

  if (authState.status !== "authenticated") {
    return null;
  }

  return (
    <main aria-label="webhook settings" className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="font-semibold text-xl tracking-tight">
          Webhook Settings
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Configure webhook delivery for external automations.
        </p>
      </header>

      {/* Startup selector */}
      <div className="mb-6">
        <Label htmlFor="startup-select">Startup</Label>
        <select
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          id="startup-select"
          onChange={(e) => setSelectedStartupId(e.target.value || null)}
          value={selectedStartupId ?? ""}
        >
          {startups.length === 0 && (
            <option value="">No startups available</option>
          )}
          {startups.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <p className="text-muted-foreground text-sm" role="status">
          Loading webhook configuration...
        </p>
      )}

      {error && (
        <Alert className="mb-4" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {webhook?.circuitBrokenAt && (
        <Alert className="mb-4" variant="destructive">
          <AlertDescription>
            <strong>Circuit breaker tripped</strong> &mdash; Webhook delivery
            was disabled after {webhook.consecutiveFailures} consecutive
            failures on {new Date(webhook.circuitBrokenAt).toLocaleString()}.
            <Button
              className="ml-3"
              disabled={saving}
              onClick={() => void handleResetCircuitBreaker()}
              size="sm"
              variant="outline"
            >
              Re-enable
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {createdSecret && <SecretBanner secret={createdSecret} />}

      {!loading && selectedStartupId && (
        <Card>
          <CardHeader>
            <CardTitle>
              {webhook ? "Update Webhook" : "Create Webhook"}
            </CardTitle>
            <CardDescription>
              {webhook
                ? `Webhook for ${selectedStartupName} is ${webhook.enabled ? "active" : "disabled"}.`
                : `No webhook configured for ${selectedStartupName}. Set one up below.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                aria-invalid={urlInput.length > 0 && !urlValid}
                id="webhook-url"
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/webhook"
                type="url"
                value={urlInput}
              />
              {urlInput.length > 0 && !urlValid && (
                <p className="text-destructive text-xs">URL must use HTTPS.</p>
              )}
            </div>

            <EventTypeSelector
              onToggle={toggleEventType}
              selected={selectedEventTypes}
            />

            <div className="flex items-center gap-3">
              <Button
                disabled={saving || !formValid}
                onClick={() => void handleSave()}
              >
                {saving && "Saving..."}
                {!saving && webhook && "Save Changes"}
                {!(saving || webhook) && "Create Webhook"}
              </Button>
              {webhook && !deleteConfirm && (
                <Button
                  onClick={() => setDeleteConfirm(true)}
                  variant="outline"
                >
                  Delete
                </Button>
              )}
              {webhook && deleteConfirm && (
                <div className="flex items-center gap-2">
                  <span className="text-destructive text-sm">
                    Delete this webhook?
                  </span>
                  <Button
                    disabled={saving}
                    onClick={() => void handleDelete()}
                    size="sm"
                    variant="destructive"
                  >
                    Confirm
                  </Button>
                  <Button
                    onClick={() => setDeleteConfirm(false)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {webhook && (
        <>
          <Separator className="my-6" />
          <DeliveryLog entries={deliveryLog} loading={deliveryLogLoading} />
        </>
      )}
    </main>
  );
}
