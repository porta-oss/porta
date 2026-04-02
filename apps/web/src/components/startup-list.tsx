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
          <p className="text-muted-foreground text-sm" role="status">
            Loading startups…
          </p>
        ) : null}
        {status === "refreshing" ? (
          <p className="text-muted-foreground text-sm" role="status">
            Refreshing startups…
          </p>
        ) : null}

        {status === "error" ? (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertDescription>
                {error ?? "Startups could not be loaded."}
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => void onRetry?.()}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : null}

        {status !== "error" && !workspaceName ? (
          <div className="grid gap-2">
            <p className="text-sm">Select a workspace to see your startups.</p>
            <a
              className="text-primary text-sm underline underline-offset-4"
              href="/app/onboarding"
            >
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
            <a
              className="text-primary text-sm underline underline-offset-4"
              href="/app/onboarding"
            >
              Add the first startup profile
            </a>
          </div>
        ) : null}

        {startups.length > 0 ? (
          <ul className="m-0 grid list-none gap-1 p-0">
            {startups.map((startup) => (
              <li
                className="flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted/50"
                key={startup.id}
              >
                <span className="font-medium text-sm">{startup.name}</span>
                <span className="text-muted-foreground text-xs">
                  {startup.stage.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
