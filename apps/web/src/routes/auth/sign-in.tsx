import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
        <AlertDescription role="status">
          Checking your session\u2026
        </AlertDescription>
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

  async function handleMagicLinkSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
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
            <span className="text-muted-foreground text-xs">or</span>
            <Separator className="flex-1" />
          </div>

          <form className="grid gap-3" onSubmit={handleMagicLinkSubmit}>
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

          <p className="text-muted-foreground text-sm">
            You'll be redirected to{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {redirectTo || DEFAULT_AUTH_REDIRECT_PATH}
            </code>{" "}
            after signing in.
          </p>
          <a
            className="text-primary text-sm underline-offset-4 hover:underline"
            href="/app"
          >
            Go to the dashboard
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
