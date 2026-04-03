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
  workspaceError?: string | null;
  workspaces: WorkspaceSummary[];
}

export function AppShell({
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
    <main
      aria-label="portfolio dashboard"
      className="grid gap-8 bg-background p-6 pb-10"
    >
      <header>
        <h1 className="font-semibold text-xl leading-tight tracking-display">
          Portfolio overview
        </h1>
      </header>

      {shellStatus === "loading" ? (
        <p className="text-muted-foreground" role="status">
          Loading your dashboard…
        </p>
      ) : null}

      {shellStatus === "error" ? (
        <Card className="border-danger-border bg-danger-bg">
          <CardContent className="grid gap-3 pt-5">
            <Alert variant="destructive">
              <AlertDescription>
                {shellError ?? "The dashboard could not be loaded."}
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => void onRetryShell?.()}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-[minmax(0,18rem)_minmax(0,1fr)] gap-6">
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

        <section aria-label="dashboard content" className="grid gap-4">
          {children ?? (
            <>
              <h2>Workspace overview</h2>
              <p className="text-muted-foreground">
                Select a startup to view health metrics, insights, and tasks.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
