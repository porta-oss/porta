import type { ApiKeyScope } from "@shared/api-key";
import { API_KEY_SCOPES } from "@shared/api-key";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_BASE_URL, type AuthSnapshot } from "@/lib/auth-client";
import { authenticatedRoute } from "../../_authenticated";

// ------------------------------------------------------------------
// Route definition
// ------------------------------------------------------------------

export const apiKeySettingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "app/settings/api-keys",
  component: ApiKeySettingsRouteComponent,
});

function ApiKeySettingsRouteComponent() {
  const authState = apiKeySettingsRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot,
  });

  return <ApiKeySettingsPage authState={authState} />;
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

interface ApiKeyRow {
  createdAt: string;
  id: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  name: string;
  scope: string;
}

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

function CreatedKeyBanner({ fullKey }: { fullKey: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(fullKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="mb-4 border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
      <CardContent className="pt-5">
        <p className="mb-2 font-medium text-sm">API key (shown once):</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
            {fullKey}
          </code>
          <Button onClick={copy} size="sm" variant="outline">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          Store this key securely. It will not be shown again.
        </p>
      </CardContent>
    </Card>
  );
}

function ApiKeyTableRow({
  apiKey,
  onRevoke,
  revoking,
}: {
  apiKey: ApiKeyRow;
  onRevoke: (id: string) => void;
  revoking: string | null;
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  return (
    <div className="flex items-center justify-between rounded border border-input px-3 py-2 text-sm">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{apiKey.name}</span>
          <Badge variant={apiKey.scope === "write" ? "default" : "secondary"}>
            {apiKey.scope}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          <code>{apiKey.keyPrefix}...</code>
          <span>Created {new Date(apiKey.createdAt).toLocaleDateString()}</span>
          {apiKey.lastUsedAt && (
            <span>
              Last used {new Date(apiKey.lastUsedAt).toLocaleDateString()}
            </span>
          )}
          {!apiKey.lastUsedAt && <span>Never used</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!confirmRevoke && (
          <Button
            disabled={revoking === apiKey.id}
            onClick={() => setConfirmRevoke(true)}
            size="sm"
            variant="outline"
          >
            Revoke
          </Button>
        )}
        {confirmRevoke && (
          <>
            <span className="text-destructive text-xs">Revoke this key?</span>
            <Button
              disabled={revoking === apiKey.id}
              onClick={() => onRevoke(apiKey.id)}
              size="sm"
              variant="destructive"
            >
              {revoking === apiKey.id ? "Revoking..." : "Confirm"}
            </Button>
            <Button
              onClick={() => setConfirmRevoke(false)}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Main page component
// ------------------------------------------------------------------

interface ApiKeySettingsPageProps {
  authState: AuthSnapshot;
}

export function ApiKeySettingsPage({ authState }: ApiKeySettingsPageProps) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [scopeInput, setScopeInput] = useState<ApiKeyScope>("read");

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest("/settings/api-keys");
      if (isRecord(payload) && Array.isArray(payload.apiKeys)) {
        setKeys(
          payload.apiKeys.filter(isRecord).map((k) => ({
            id: String(k.id),
            name: typeof k.name === "string" ? k.name : "",
            keyPrefix: typeof k.keyPrefix === "string" ? k.keyPrefix : "",
            scope: typeof k.scope === "string" ? k.scope : "read",
            lastUsedAt: typeof k.lastUsedAt === "string" ? k.lastUsedAt : null,
            createdAt: typeof k.createdAt === "string" ? k.createdAt : "",
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function handleCreate() {
    const name = nameInput.trim();
    if (!name) {
      return;
    }
    setCreating(true);
    setError(null);
    setCreatedKey(null);
    try {
      const payload = await apiRequest("/settings/api-keys", {
        method: "POST",
        body: JSON.stringify({ name, scope: scopeInput }),
      });
      if (isRecord(payload) && typeof payload.key === "string") {
        setCreatedKey(payload.key);
        setShowCreateForm(false);
        setNameInput("");
        setScopeInput("read");
        void loadKeys();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    setRevoking(keyId);
    setError(null);
    try {
      await apiRequest(`/settings/api-keys/${keyId}`, { method: "DELETE" });
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setRevoking(null);
    }
  }

  const nameValid = nameInput.trim().length > 0;

  if (authState.status !== "authenticated") {
    return null;
  }

  return (
    <main aria-label="API key settings" className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="font-semibold text-xl tracking-tight">API Keys</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Manage API keys for MCP and programmatic access.
        </p>
      </header>

      {error && (
        <Alert className="mb-4" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {createdKey && <CreatedKeyBanner fullKey={createdKey} />}

      {/* Create key form */}
      {!showCreateForm && (
        <div className="mb-6">
          <Button onClick={() => setShowCreateForm(true)}>
            Create API Key
          </Button>
        </div>
      )}

      {showCreateForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create API Key</CardTitle>
            <CardDescription>
              Generate a new key for MCP or programmatic access.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. CI Pipeline, Claude Desktop"
                type="text"
                value={nameInput}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="api-key-scope">Scope</Label>
              <Select
                onValueChange={(value) => setScopeInput(value as ApiKeyScope)}
                value={scopeInput}
              >
                <SelectTrigger aria-label="Select scope" className="w-full">
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  {API_KEY_SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {scope === "read"
                        ? "Read-only \u2014 5 read tools"
                        : "Read-write \u2014 all 8 tools"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Button
                disabled={creating || !nameValid}
                onClick={() => void handleCreate()}
              >
                {creating ? "Creating..." : "Create Key"}
              </Button>
              <Button
                onClick={() => {
                  setShowCreateForm(false);
                  setNameInput("");
                  setScopeInput("read");
                }}
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keys list */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Keys</CardTitle>
          <CardDescription>Active API keys for this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && (
            <p className="text-muted-foreground text-sm" role="status">
              Loading API keys...
            </p>
          )}
          {!loading && keys.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No API keys created yet.
            </p>
          )}
          {!loading && keys.length > 0 && (
            <div className="grid gap-2">
              {keys.map((k) => (
                <ApiKeyTableRow
                  apiKey={k}
                  key={k.id}
                  onRevoke={(id) => void handleRevoke(id)}
                  revoking={revoking}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
