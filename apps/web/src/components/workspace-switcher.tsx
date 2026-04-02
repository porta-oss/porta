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
                <SelectTrigger
                  className="min-w-56"
                  id="workspace-switcher-select"
                >
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
          <p className="text-muted-foreground text-sm">
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
