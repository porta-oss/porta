import { EVENT_TYPES, type EventType } from "@shared/event-log";
import { RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventFilterValues {
  dateFrom: string | null;
  dateTo: string | null;
  eventTypes: Set<EventType>;
}

export interface EventFilterProps {
  onApply: (filters: EventFilterValues) => void;
}

// ---------------------------------------------------------------------------
// Category grouping
// ---------------------------------------------------------------------------

type EventCategory =
  | "alert"
  | "connector"
  | "insight"
  | "mcp"
  | "task"
  | "telegram"
  | "webhook";

const CATEGORY_LABELS: Record<EventCategory, string> = {
  alert: "Alert",
  connector: "Connector",
  insight: "Insight",
  telegram: "Telegram",
  mcp: "MCP",
  task: "Task",
  webhook: "Webhook",
};

const CATEGORY_ORDER: EventCategory[] = [
  "alert",
  "connector",
  "insight",
  "telegram",
  "mcp",
  "task",
  "webhook",
];

function groupByCategory(): Record<EventCategory, EventType[]> {
  const groups: Record<string, EventType[]> = {};
  for (const et of EVENT_TYPES) {
    const category = et.split(".")[0];
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(et);
  }
  return groups as Record<EventCategory, EventType[]>;
}

const GROUPED_EVENTS = groupByCategory();

// Default selected: alert + insight + task
const DEFAULT_TYPES = new Set<EventType>(
  EVENT_TYPES.filter((et) => {
    const cat = et.split(".")[0];
    return cat === "alert" || cat === "insight" || cat === "task";
  })
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventFilter({ onApply }: EventFilterProps) {
  const [selectedTypes, setSelectedTypes] = useState<Set<EventType>>(
    () => new Set(DEFAULT_TYPES)
  );
  const [showAll, setShowAll] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const handleShowAll = useCallback(() => {
    const next = !showAll;
    setShowAll(next);
    setSelectedTypes(
      next ? new Set<EventType>(EVENT_TYPES) : new Set(DEFAULT_TYPES)
    );
  }, [showAll]);

  const handleReset = useCallback(() => {
    setSelectedTypes(new Set(DEFAULT_TYPES));
    setShowAll(false);
    setDateFrom("");
    setDateTo("");
    onApply({
      eventTypes: new Set(DEFAULT_TYPES),
      dateFrom: null,
      dateTo: null,
    });
  }, [onApply]);

  const handleApply = useCallback(() => {
    onApply({
      eventTypes: new Set(selectedTypes),
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    });
  }, [onApply, selectedTypes, dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-3" data-testid="event-filter">
      {/* Category checkboxes */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 rounded border border-input px-2 py-2 text-xs transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 md:py-1">
          <input
            checked={showAll}
            className="accent-primary"
            data-testid="show-all-toggle"
            onChange={handleShowAll}
            type="checkbox"
          />
          <span>Show all</span>
        </label>

        {CATEGORY_ORDER.map((category) => {
          const types = GROUPED_EVENTS[category];
          const allChecked = types.every((et) => selectedTypes.has(et));
          const someChecked =
            !allChecked && types.some((et) => selectedTypes.has(et));

          return (
            <label
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded border border-input px-2 py-2 text-xs transition-colors md:py-1",
                allChecked && "border-primary bg-primary/5",
                someChecked && "border-primary/50 bg-primary/[0.02]"
              )}
              key={category}
            >
              <input
                checked={allChecked}
                className="accent-primary"
                data-testid={`category-${category}`}
                onChange={() => {
                  setSelectedTypes((prev) => {
                    const next = new Set(prev);
                    if (allChecked) {
                      for (const et of types) {
                        next.delete(et);
                      }
                    } else {
                      for (const et of types) {
                        next.add(et);
                      }
                    }
                    return next;
                  });
                  setShowAll(false);
                }}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = someChecked;
                  }
                }}
                type="checkbox"
              />
              <span>{CATEGORY_LABELS[category]}</span>
            </label>
          );
        })}
      </div>

      {/* Date range + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">From</span>
          <Input
            className="h-9 w-32 px-2 text-xs md:h-7"
            data-testid="date-from"
            onChange={(e) => setDateFrom(e.target.value)}
            type="date"
            value={dateFrom}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">To</span>
          <Input
            className="h-9 w-32 px-2 text-xs md:h-7"
            data-testid="date-to"
            onChange={(e) => setDateTo(e.target.value)}
            type="date"
            value={dateTo}
          />
        </div>

        <Button
          className="min-h-[44px] md:min-h-0"
          data-testid="apply-filters"
          onClick={handleApply}
          size="xs"
          variant="default"
        >
          Apply
        </Button>
        <Button
          className="min-h-[44px] md:min-h-0"
          data-testid="reset-filters"
          onClick={handleReset}
          size="xs"
          variant="ghost"
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
      </div>
    </div>
  );
}
