import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type FreshnessLevel = "fresh" | "warning" | "stale";

const TICK_INTERVAL_MS = 30_000;
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

function getFreshnessLevel(ageMs: number): FreshnessLevel {
  if (ageMs >= STALE_THRESHOLD_MS) {
    return "stale";
  }
  if (ageMs >= WARNING_THRESHOLD_MS) {
    return "warning";
  }
  return "fresh";
}

function formatRelativeTime(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

interface DataFreshnessBadgeProps {
  className?: string;
  fetchedAt: number | null;
  label?: string;
}

export function DataFreshnessBadge({
  className,
  fetchedAt,
  label = "Updated",
}: DataFreshnessBadgeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (fetchedAt === null) {
    return null;
  }

  const ageMs = now - fetchedAt;
  const level = getFreshnessLevel(ageMs);
  const relative = formatRelativeTime(ageMs);

  return (
    <span
      aria-label={`${label} ${relative}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-xs",
        level === "fresh" && "text-muted-foreground",
        level === "warning" &&
          "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        level === "stale" && "bg-red-500/15 text-red-600 dark:text-red-400",
        className
      )}
      data-freshness={level}
      data-testid="data-freshness-badge"
      role="timer"
    >
      {level === "stale" ? (
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-full bg-red-500"
        />
      ) : null}
      {level === "stale" ? "Data may be outdated" : `${label} ${relative}`}
    </span>
  );
}

export {
  formatRelativeTime,
  getFreshnessLevel,
  STALE_THRESHOLD_MS,
  WARNING_THRESHOLD_MS,
};
