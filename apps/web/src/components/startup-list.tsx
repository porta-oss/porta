import type { HealthState } from "@shared/startup-health";
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
import {
  startupIndicatorVariant,
  startupRowToneClass,
  toStartupHealthTone,
} from "@/lib/startup-health-tone";
import { cn } from "@/lib/utils";

export interface StartupListProps {
  activeStartupId?: string | null;
  error?: string | null;
  onRetry?: () => void | Promise<void>;
  onSelectStartup?: (startupId: string) => void | Promise<void>;
  startupHealthById?: Record<string, HealthState | "load-error">;
  startups: StartupRecord[];
  status: "idle" | "loading" | "refreshing" | "ready" | "error";
  workspaceName: string | null;
}

export function StartupList({
  activeStartupId = null,
  workspaceName,
  startups,
  status,
  error = null,
  onRetry,
  onSelectStartup,
  startupHealthById = {},
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
          <ul
            className="m-0 grid list-none gap-1 p-0"
            data-health-summary-count={Object.keys(startupHealthById).length}
          >
            {startups.map((startup) => {
              const isActive = startup.id === activeStartupId;
              const tone = toStartupHealthTone(
                startupHealthById[startup.id] ?? null
              );
              const indicatorVariant = startupIndicatorVariant(tone);

              return (
                <li key={startup.id}>
                  <button
                    aria-pressed={isActive}
                    className={cn(
                      "flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors",
                      isActive ? startupRowToneClass(tone) : "hover:bg-muted/50"
                    )}
                    data-health-indicator={indicatorVariant}
                    data-health-tone={tone}
                    onClick={() => void onSelectStartup?.(startup.id)}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          indicatorVariant === "ring" &&
                            "border border-danger bg-card",
                          tone === "healthy" &&
                            indicatorVariant === "solid" &&
                            "bg-success",
                          tone === "attention" &&
                            indicatorVariant === "solid" &&
                            "bg-warning",
                          tone === "blocked" &&
                            indicatorVariant === "solid" &&
                            "bg-danger"
                        )}
                      />
                      <span className="font-medium text-sm">
                        {startup.name}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {startup.stage.replace("_", " ")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
