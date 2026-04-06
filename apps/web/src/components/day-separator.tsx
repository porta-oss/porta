// ---------------------------------------------------------------------------
// Day Separator — date headers between event log groups
// ---------------------------------------------------------------------------

export interface DaySeparatorProps {
  /** ISO date string (e.g. "2026-04-06") or Date object */
  date: string | Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatLabel(date: Date): string {
  const now = new Date();
  const todayMs = startOfDay(now);
  const dateMs = startOfDay(date);

  if (dateMs === todayMs) {
    return "Today";
  }

  const yesterdayMs = todayMs - 86_400_000;
  if (dateMs === yesterdayMs) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DaySeparator({ date }: DaySeparatorProps) {
  const d = typeof date === "string" ? new Date(date) : date;
  const label = formatLabel(d);

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="h-px flex-1 bg-border" />
      <span className="shrink-0 font-medium text-muted-foreground text-xs">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
