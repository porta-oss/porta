import { LayoutGrid, NotebookText, Scale } from "lucide-react";
import { useEffect } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type DashboardMode = "decide" | "journal" | "compare";

const modes: {
  value: DashboardMode;
  label: string;
  icon: typeof Scale;
  shortcut: string;
}[] = [
  { value: "decide", label: "Decide", icon: Scale, shortcut: "1" },
  { value: "journal", label: "Journal", icon: NotebookText, shortcut: "2" },
  { value: "compare", label: "Compare", icon: LayoutGrid, shortcut: "3" },
];

interface ModeSwitcherProps {
  className?: string;
  onChange: (mode: DashboardMode) => void;
  value: DashboardMode;
}

export function ModeSwitcher({
  value,
  onChange,
  className,
}: ModeSwitcherProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const mode = modes.find((m) => m.shortcut === e.key);
      if (mode) {
        e.preventDefault();
        onChange(mode.value);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChange]);

  return (
    <Tabs
      className={cn("w-auto", className)}
      onValueChange={(v) => onChange(v as DashboardMode)}
      value={value}
    >
      <TabsList role="tablist">
        {modes.map((mode) => (
          <TabsTrigger key={mode.value} role="tab" value={mode.value}>
            <mode.icon className="size-4" />
            {mode.label}
            <kbd className="ml-1 hidden rounded bg-muted-foreground/10 px-1 font-mono text-[10px] text-muted-foreground md:inline-block">
              {"\u2318"}
              {mode.shortcut}
            </kbd>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
