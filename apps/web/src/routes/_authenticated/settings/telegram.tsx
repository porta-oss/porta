import type { TelegramConfigSummary } from "@shared/telegram";
import { STARTUP_TIMEZONES } from "@shared/types";
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
import { Separator } from "@/components/ui/separator";
import { API_BASE_URL, type AuthSnapshot } from "@/lib/auth-client";
import { authenticatedRoute } from "../../_authenticated";

// ------------------------------------------------------------------
// Route definition
// ------------------------------------------------------------------

export const telegramSettingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "app/settings/telegram",
  component: TelegramSettingsRouteComponent,
});

function TelegramSettingsRouteComponent() {
  const authState = telegramSettingsRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot,
  });

  return <TelegramSettingsPage authState={authState} />;
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
// Bot token format regex (same as shared schema)
// ------------------------------------------------------------------

const BOT_TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]{35}$/;

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

function BotFatherGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup Instructions</CardTitle>
        <CardDescription>
          Create a Telegram bot to receive digest and alert notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ol className="grid gap-2 text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-medium text-foreground">1.</span>
            Open Telegram and search for{" "}
            <strong className="text-foreground">@BotFather</strong>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">2.</span>
            Send <code className="rounded bg-muted px-1">/newbot</code> and
            follow the prompts to name your bot
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">3.</span>
            Copy the bot token (looks like{" "}
            <code className="rounded bg-muted px-1">123456789:ABCdef...</code>)
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">4.</span>
            Paste the token below
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function VerificationBanner({
  botUsername,
  verificationCode,
}: {
  botUsername: string;
  verificationCode: string;
}) {
  const [copied, setCopied] = useState(false);
  const startCommand = `/start ${verificationCode}`;

  function copy() {
    void navigator.clipboard.writeText(startCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
      <CardContent className="pt-5">
        <p className="mb-2 font-medium text-sm">
          Send this command to <strong>@{botUsername}</strong> in Telegram:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-muted px-2 py-1 font-mono text-sm">
            {startCommand}
          </code>
          <Button onClick={copy} size="sm" variant="outline">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          The code expires in 15 minutes. After sending, this page will show
          your connected status.
        </p>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// Generate time options for HH:MM picker
// ------------------------------------------------------------------

function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      options.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      );
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

// ------------------------------------------------------------------
// Main page component
// ------------------------------------------------------------------

interface TelegramSettingsPageProps {
  authState: AuthSnapshot;
}

export function TelegramSettingsPage({ authState }: TelegramSettingsPageProps) {
  const [config, setConfig] = useState<TelegramConfigSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  // Setup form state
  const [botTokenInput, setBotTokenInput] = useState("");
  const [digestTimeInput, setDigestTimeInput] = useState("09:00");
  const [digestTimezoneInput, setDigestTimezoneInput] = useState("UTC");

  // Verification state (shown after successful setup)
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [verificationBotUsername, setVerificationBotUsername] = useState<
    string | null
  >(null);

  // Load current config
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest("/workspace/telegram");
      if (isRecord(payload) && isRecord(payload.config)) {
        const c = payload.config as unknown as TelegramConfigSummary;
        setConfig(c);
        setDigestTimeInput(c.digestTime);
        setDigestTimezoneInput(c.digestTimezone);
      } else {
        setConfig(null);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load Telegram configuration"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Validation
  const tokenValid = BOT_TOKEN_REGEX.test(botTokenInput);

  // Setup handler
  async function handleSetup() {
    if (!tokenValid) {
      return;
    }
    setSaving(true);
    setError(null);
    setVerificationCode(null);
    try {
      const payload = await apiRequest("/workspace/telegram", {
        method: "POST",
        body: JSON.stringify({
          botToken: botTokenInput,
          digestTime: digestTimeInput,
          digestTimezone: digestTimezoneInput,
        }),
      });

      if (isRecord(payload)) {
        if (isRecord(payload.config)) {
          const c = payload.config as unknown as TelegramConfigSummary;
          setConfig(c);
          setVerificationBotUsername(c.botUsername);
        }
        if (typeof payload.verificationCode === "string") {
          setVerificationCode(payload.verificationCode);
        }
      }
      setBotTokenInput("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to setup Telegram bot"
      );
    } finally {
      setSaving(false);
    }
  }

  // Unlink handler
  async function handleUnlink() {
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/workspace/telegram", { method: "DELETE" });
      setConfig(null);
      setVerificationCode(null);
      setVerificationBotUsername(null);
      setBotTokenInput("");
      setUnlinkConfirm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to unlink Telegram"
      );
    } finally {
      setSaving(false);
    }
  }

  if (authState.status !== "authenticated") {
    return null;
  }

  const isLinked = config?.isActive && config.chatId;

  return (
    <main aria-label="telegram settings" className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="font-semibold text-xl tracking-tight">
          Telegram Notifications
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Receive daily digest summaries and real-time alert notifications via
          Telegram.
        </p>
      </header>

      {loading && (
        <p className="text-muted-foreground text-sm" role="status">
          Loading Telegram configuration...
        </p>
      )}

      {error && (
        <Alert className="mb-4" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Verification code banner */}
      {verificationCode && verificationBotUsername && !isLinked && (
        <div className="mb-4">
          <VerificationBanner
            botUsername={verificationBotUsername}
            verificationCode={verificationCode}
          />
        </div>
      )}

      {!(loading || isLinked) && (
        <>
          {/* BotFather guide */}
          <div className="mb-4">
            <BotFatherGuide />
          </div>

          {/* Setup form */}
          <Card>
            <CardHeader>
              <CardTitle>Connect Telegram Bot</CardTitle>
              <CardDescription>
                {config?.botUsername
                  ? `Bot @${config.botUsername} is configured but not yet linked. Send the verification code above to complete setup.`
                  : "Enter your bot token to get started."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="bot-token">Bot Token</Label>
                <Input
                  aria-invalid={botTokenInput.length > 0 && !tokenValid}
                  id="bot-token"
                  onChange={(e) => setBotTokenInput(e.target.value)}
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz12345678"
                  type="text"
                  value={botTokenInput}
                />
                {botTokenInput.length > 0 && !tokenValid && (
                  <p className="text-destructive text-xs">
                    Invalid bot token format. Expected: digits:35-character
                    alphanumeric string.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="digest-time">Digest Time</Label>
                  <Select
                    onValueChange={setDigestTimeInput}
                    value={digestTimeInput}
                  >
                    <SelectTrigger id="digest-time">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="digest-timezone">Timezone</Label>
                  <Select
                    onValueChange={setDigestTimezoneInput}
                    value={digestTimezoneInput}
                  >
                    <SelectTrigger id="digest-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STARTUP_TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                disabled={saving || !tokenValid}
                onClick={() => void handleSetup()}
              >
                {saving ? "Setting up..." : "Setup Bot"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* Connected state */}
      {!loading && isLinked && config && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Connected
              <Badge variant="default">Active</Badge>
            </CardTitle>
            <CardDescription>
              Bot <strong>@{config.botUsername}</strong> is linked and sending
              notifications.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Chat linked</span>
                <p className="font-medium">Yes</p>
              </div>
              <div>
                <span className="text-muted-foreground">Last digest</span>
                <p className="font-medium">
                  {config.lastDigestAt
                    ? new Date(config.lastDigestAt).toLocaleString()
                    : "Not yet sent"}
                </p>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="connected-digest-time">Digest Time</Label>
                <Select
                  onValueChange={setDigestTimeInput}
                  value={digestTimeInput}
                >
                  <SelectTrigger id="connected-digest-time">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="connected-digest-timezone">Timezone</Label>
                <Select
                  onValueChange={setDigestTimezoneInput}
                  value={digestTimezoneInput}
                >
                  <SelectTrigger id="connected-digest-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STARTUP_TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {!unlinkConfirm && (
                <Button
                  onClick={() => setUnlinkConfirm(true)}
                  variant="outline"
                >
                  Unlink Bot
                </Button>
              )}
              {unlinkConfirm && (
                <div className="flex items-center gap-2">
                  <span className="text-destructive text-sm">
                    Unlink this bot? You will stop receiving notifications.
                  </span>
                  <Button
                    disabled={saving}
                    onClick={() => void handleUnlink()}
                    size="sm"
                    variant="destructive"
                  >
                    Confirm
                  </Button>
                  <Button
                    onClick={() => setUnlinkConfirm(false)}
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
    </main>
  );
}
