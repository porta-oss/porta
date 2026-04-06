import type { HealthState } from "@shared/startup-health";
import type {
  UniversalMetricKey,
  UniversalMetrics,
} from "@shared/universal-metrics";
import {
  METRIC_LABELS,
  METRIC_UNITS,
  UNIVERSAL_METRIC_KEYS,
} from "@shared/universal-metrics";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Minus,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-media-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartupComparison {
  healthState: HealthState;
  id: string;
  metrics: UniversalMetrics;
  name: string;
  previousMetrics?: UniversalMetrics | null;
  /** Per-source custom metrics for expandable detail */
  sourceMetrics?: Record<string, Record<string, number | null>> | null;
}

export interface ComparisonMatrixProps {
  startups: StartupComparison[];
}

// ---------------------------------------------------------------------------
// Sort state
// ---------------------------------------------------------------------------

type SortDirection = "asc" | "desc";

interface SortState {
  direction: SortDirection;
  key: UniversalMetricKey | "name";
}

// ---------------------------------------------------------------------------
// Health badge config
// ---------------------------------------------------------------------------

const HEALTH_CONFIG: Record<
  HealthState,
  {
    label: string;
    variant: "default" | "destructive" | "outline" | "secondary";
  }
> = {
  ready: { label: "Healthy", variant: "default" },
  syncing: { label: "Syncing", variant: "secondary" },
  stale: { label: "Stale", variant: "secondary" },
  blocked: { label: "Blocked", variant: "destructive" },
  error: { label: "Error", variant: "destructive" },
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatMetricValue(key: UniversalMetricKey, value: number): string {
  const unit = METRIC_UNITS[key];
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "count":
      return new Intl.NumberFormat("en-US").format(value);
    default:
      return String(value);
  }
}

function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined
): "down" | "flat" | "up" | null {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
  ) {
    return null;
  }
  if (current > previous) {
    return "up";
  }
  if (current < previous) {
    return "down";
  }
  return "flat";
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function sortStartups(
  startups: StartupComparison[],
  sort: SortState
): StartupComparison[] {
  const sorted = [...startups];
  sorted.sort((a, b) => {
    if (sort.key === "name") {
      const cmp = a.name.localeCompare(b.name);
      return sort.direction === "asc" ? cmp : -cmp;
    }
    const aVal = a.metrics[sort.key] ?? null;
    const bVal = b.metrics[sort.key] ?? null;
    if (aVal === null && bVal === null) {
      return 0;
    }
    if (aVal === null) {
      return 1;
    }
    if (bVal === null) {
      return -1;
    }
    const cmp = aVal - bVal;
    return sort.direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DeltaIndicator({
  direction,
}: {
  direction: "down" | "flat" | "up" | null;
}) {
  if (direction === "up") {
    return (
      <ArrowUp
        aria-label="increased"
        className="inline size-3 text-emerald-500"
      />
    );
  }
  if (direction === "down") {
    return (
      <ArrowDown
        aria-label="decreased"
        className="inline size-3 text-red-500"
      />
    );
  }
  if (direction === "flat") {
    return (
      <Minus
        aria-label="no change"
        className="inline size-3 text-muted-foreground"
      />
    );
  }
  return null;
}

function SortIndicator({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return null;
  }
  return (
    <span
      aria-label={
        direction === "asc" ? "sorted ascending" : "sorted descending"
      }
      className="ml-1"
      role="img"
    >
      {direction === "asc" ? "\u2191" : "\u2193"}
    </span>
  );
}

function SourceDetail({
  sourceMetrics,
}: {
  sourceMetrics: Record<string, Record<string, number | null>>;
}) {
  const sources = Object.entries(sourceMetrics);
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 px-3 py-2">
      {sources.map(([source, metrics]) => (
        <div key={source}>
          <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {source}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(metrics).map(([key, value]) => (
              <span className="text-sm" key={key}>
                <span className="text-muted-foreground">{key}:</span>{" "}
                <span className="tabular-nums">
                  {value === null ? "\u2014" : String(value)}
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile card view
// ---------------------------------------------------------------------------

function MobileComparisonCard({ startup }: { startup: StartupComparison }) {
  const [expanded, setExpanded] = useState(false);
  const health = HEALTH_CONFIG[startup.healthState];
  const hasSourceMetrics =
    startup.sourceMetrics && Object.keys(startup.sourceMetrics).length > 0;

  return (
    <Card>
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center justify-between">
          <span className="font-medium">{startup.name}</span>
          <Badge variant={health.variant}>{health.label}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {UNIVERSAL_METRIC_KEYS.map((key) => {
            const value = startup.metrics[key];
            const prevValue = startup.previousMetrics?.[key];
            const delta = computeDelta(value, prevValue);

            return (
              <div key={key}>
                <p className="text-muted-foreground text-xs">
                  {METRIC_LABELS[key]}
                </p>
                <p className="text-sm tabular-nums">
                  {value !== null && value !== undefined ? (
                    <span>
                      {formatMetricValue(key, value)}{" "}
                      <DeltaIndicator direction={delta} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{"\u2014"}</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        {hasSourceMetrics ? (
          <>
            <button
              aria-expanded={expanded}
              className="flex min-h-[44px] items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => setExpanded((prev) => !prev)}
              type="button"
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Source details
            </button>
            {expanded ? (
              <SourceDetail
                sourceMetrics={
                  startup.sourceMetrics as Record<
                    string,
                    Record<string, number | null>
                  >
                }
              />
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ComparisonMatrix({ startups }: ComparisonMatrixProps) {
  const isMobile = useIsMobile();
  const [sort, setSort] = useState<SortState>({
    key: "name",
    direction: "asc",
  });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Empty state
  if (startups.length === 0) {
    return (
      <Card aria-label="Startup comparison">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">
            No startups to compare. Add startups to see the comparison matrix.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sorted = sortStartups(startups, sort);

  // Mobile: stacked cards layout
  if (isMobile) {
    return (
      <section aria-label="Startup comparison" className="grid gap-3">
        {sorted.map((startup) => (
          <MobileComparisonCard key={startup.id} startup={startup} />
        ))}
      </section>
    );
  }

  function handleSort(key: UniversalMetricKey | "name") {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: key === "name" ? "asc" : "desc" };
    });
  }

  function toggleExpanded(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <Card aria-label="Startup comparison">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>
                <button
                  className="inline-flex items-center font-medium hover:text-foreground"
                  onClick={() => handleSort("name")}
                  type="button"
                >
                  Startup
                  <SortIndicator
                    active={sort.key === "name"}
                    direction={sort.direction}
                  />
                </button>
              </TableHead>
              <TableHead>Status</TableHead>
              {UNIVERSAL_METRIC_KEYS.map((key) => (
                <TableHead className="text-right" key={key}>
                  <button
                    className="inline-flex items-center font-medium hover:text-foreground"
                    onClick={() => handleSort(key)}
                    type="button"
                  >
                    {METRIC_LABELS[key]}
                    <SortIndicator
                      active={sort.key === key}
                      direction={sort.direction}
                    />
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((startup) => {
              const isExpanded = expandedRows.has(startup.id);
              const hasSourceMetrics =
                startup.sourceMetrics &&
                Object.keys(startup.sourceMetrics).length > 0;
              const health = HEALTH_CONFIG[startup.healthState];

              return (
                <TableRow key={startup.id}>
                  <TableCell
                    className="p-0"
                    colSpan={UNIVERSAL_METRIC_KEYS.length + 3}
                  >
                    <div className="flex items-center">
                      {/* Expand toggle */}
                      <div className="flex w-8 items-center justify-center px-3 py-3">
                        {hasSourceMetrics ? (
                          <button
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${startup.name} details`}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => toggleExpanded(startup.id)}
                            type="button"
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </button>
                        ) : null}
                      </div>

                      {/* Name */}
                      <div className="min-w-[120px] px-3 py-3 font-medium">
                        {startup.name}
                      </div>

                      {/* Health badge */}
                      <div className="px-3 py-3">
                        <Badge variant={health.variant}>{health.label}</Badge>
                      </div>

                      {/* Metric cells */}
                      {UNIVERSAL_METRIC_KEYS.map((key) => {
                        const value = startup.metrics[key];
                        const prevValue = startup.previousMetrics?.[key];
                        const delta = computeDelta(value, prevValue);

                        return (
                          <div
                            className="min-w-[100px] px-3 py-3 text-right tabular-nums"
                            key={key}
                          >
                            {value !== null && value !== undefined ? (
                              <span>
                                {formatMetricValue(key, value)}{" "}
                                <DeltaIndicator direction={delta} />
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {"\u2014"}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Expandable source detail */}
                    {isExpanded && hasSourceMetrics ? (
                      <div className="border-t bg-muted/30">
                        <SourceDetail
                          sourceMetrics={
                            startup.sourceMetrics as Record<
                              string,
                              Record<string, number | null>
                            >
                          }
                        />
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
