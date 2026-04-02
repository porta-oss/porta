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
          <p className="text-[oklch(0.78_0.02_270)] text-sm uppercase tracking-wider">
            Founder dashboard
          </p>
          <h1 className="text-xl leading-tight">Portfolio overview</h1>
          <p className="text-[oklch(0.88_0.008_80)]">
            {user.name ? `${user.name} (${user.email})` : user.email} —
            prioritize and monitor your startups from one surface.
          </p>
        </CardContent>
      </Card>

      {shellStatus === "loading" ? (
        <p className="text-muted-foreground" role="status">
          Loading your dashboard…
        </p>
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
