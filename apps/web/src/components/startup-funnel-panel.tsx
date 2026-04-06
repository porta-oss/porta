import type { FunnelStageRow } from "@shared/startup-health";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export interface StartupFunnelPanelProps {
  muted?: boolean;
  stages: FunnelStageRow[];
}

function formatFunnelValue(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function computeConversion(current: number, previous: number): string | null {
  if (previous === 0) {
    return null;
  }
  const pct = (current / previous) * 100;
  return `${pct.toFixed(1)}%`;
}

function barWidthPct(value: number, maxValue: number): number {
  if (maxValue === 0) {
    return 100;
  }
  return Math.max(4, (value / maxValue) * 100);
}

export function StartupFunnelPanel({
  stages,
  muted = false,
}: StartupFunnelPanelProps) {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const maxValue = sorted[0]?.value ?? 0;

  return (
    <Card aria-label="funnel">
      <CardContent className="grid gap-2">
        {sorted.map((stage, idx) => {
          const prev = idx > 0 ? sorted[idx - 1] : null;
          const conversion = prev
            ? computeConversion(stage.value, prev.value)
            : null;

          return (
            <section
              aria-label={stage.label}
              className="grid gap-0.5"
              key={stage.key}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-medium text-sm">{stage.label}</span>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-semibold text-sm tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}
                    data-testid={`funnel-${stage.key}`}
                  >
                    {formatFunnelValue(stage.value)}
                  </span>
                  {conversion ? (
                    <span className="text-muted-foreground text-xs">
                      ({conversion})
                    </span>
                  ) : null}
                </div>
              </div>
              <Progress
                aria-label={`${stage.label} bar`}
                className="h-1.5"
                value={barWidthPct(stage.value, maxValue)}
              />
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
