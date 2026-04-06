import type { HealthState } from "@shared/startup-health";
import type { StartupRecord, WorkspaceSummary } from "@shared/types";
import { Menu, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

import { StartupList } from "./startup-list";
import { WorkspaceSwitcher } from "./workspace-switcher";

export interface AppShellProps {
  activeStartupId?: string | null;
  activeWorkspaceId: string | null;
  children?: ReactNode;
  isSwitchingWorkspace?: boolean;
  onActivateWorkspace?: (workspaceId: string) => void | Promise<void>;
  onRetryShell?: () => void | Promise<void>;
  onRetryStartups?: () => void | Promise<void>;
  onSelectStartup?: (startupId: string) => void | Promise<void>;
  shellError?: string | null;
  shellStatus: "loading" | "ready" | "error";
  startupError?: string | null;
  startupHealthById?: Record<string, HealthState | "load-error">;
  startupStatus: "idle" | "loading" | "refreshing" | "ready" | "error";
  startups: StartupRecord[];
  workspaceError?: string | null;
  workspaces: WorkspaceSummary[];
}

export function AppShell({
  workspaces,
  activeStartupId = null,
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
  onSelectStartup,
  onActivateWorkspace,
  startupHealthById = {},
  children,
}: AppShellProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  // Close sidebar when navigating away (startup selected on mobile)
  const handleSelectStartup = useCallback(
    (startupId: string) => {
      setSidebarOpen(false);
      void onSelectStartup?.(startupId);
    },
    [onSelectStartup]
  );

  // Close sidebar on escape key
  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  // Close sidebar when switching from mobile to desktop
  useEffect(() => {
    if (!isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  const sidebarContent = (
    <>
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
        activeStartupId={activeStartupId}
        error={startupError}
        onRetry={onRetryStartups}
        onSelectStartup={handleSelectStartup}
        startupHealthById={startupHealthById}
        startups={startups}
        status={startupStatus}
        workspaceName={activeWorkspace?.name ?? null}
      />
    </>
  );

  return (
    <main
      aria-label="portfolio dashboard"
      className="grid gap-8 bg-background p-4 pb-24 md:p-6 md:pb-10"
    >
      <header className="flex items-center gap-3">
        <button
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-input bg-background hover:bg-muted md:hidden"
          onClick={() => setSidebarOpen((prev) => !prev)}
          type="button"
        >
          {sidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
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

      {/* Mobile sidebar overlay */}
      {isMobile && sidebarOpen ? (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            aria-label="sidebar navigation"
            className="fixed inset-y-0 left-0 z-50 w-[280px] overflow-y-auto bg-background p-4 shadow-lg"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold text-sm">Navigation</span>
              <button
                aria-label="Close sidebar"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md hover:bg-muted"
                onClick={() => setSidebarOpen(false)}
                type="button"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="grid content-start gap-4">{sidebarContent}</div>
          </aside>
        </>
      ) : null}

      {/* Desktop/tablet layout */}
      <div
        className={cn(
          "grid gap-6",
          // Mobile: single column (sidebar hidden, shown as overlay)
          "grid-cols-1",
          // Tablet: compact sidebar
          "md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]",
          // Desktop: full sidebar
          "lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
        )}
      >
        {/* Sidebar for tablet/desktop — hidden on mobile */}
        <aside className="hidden content-start gap-4 md:grid">
          {sidebarContent}
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
