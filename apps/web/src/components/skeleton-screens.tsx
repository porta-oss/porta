import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const TASK_ROW_SKELETON_KEYS = ["task-row-1", "task-row-2"] as const;
const METRIC_TILE_SKELETON_KEYS = [
  "metric-tile-1",
  "metric-tile-2",
  "metric-tile-3",
  "metric-tile-4",
] as const;

/**
 * Skeleton matching PortfolioStartupCard layout:
 * - Name + badge row
 * - North star value + trend
 * - Freshness + top issue row
 */
export function PortfolioCardSkeleton() {
  return (
    <Card
      aria-label="portfolio startup card"
      data-testid="portfolio-startup-card"
    >
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-16 rounded-3xl" />
        </div>
        <div className="flex items-baseline gap-3">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-14" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton matching StartupHealthHero layout:
 * - Badge + timestamp row
 * - Label
 * - Big metric value
 * - Delta
 */
export function HealthHeroSkeleton() {
  return (
    <Card aria-label="startup health hero">
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-16 rounded-3xl" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-8 w-24" />
          <Skeleton className="mt-1.5 h-4 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton matching StartupInsightCard layout:
 * - Section label
 * - Condition headline
 * - Body text lines
 */
export function InsightCardSkeleton() {
  return (
    <Card aria-label="startup insight">
      <CardContent className="grid gap-3 pt-5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-5 w-48" />
        <div className="grid gap-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton matching StartupTaskList layout:
 * - Section label
 * - 2 task rows with title + badge + description
 */
export function TaskListSkeleton() {
  return (
    <div className="grid gap-2">
      {TASK_ROW_SKELETON_KEYS.map((key) => (
        <div className="grid gap-1 border-muted border-b py-3" key={key}>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-14 rounded-3xl" />
          </div>
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton matching StartupMetricsGrid layout:
 * - Grid of metric tiles
 */
export function MetricsGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
      {METRIC_TILE_SKELETON_KEYS.map((key) => (
        <div className="grid gap-1 rounded-lg bg-muted/50 p-3" key={key}>
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}
