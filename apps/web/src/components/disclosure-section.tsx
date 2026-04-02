import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export interface DisclosureSectionProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  title: string;
}

export function DisclosureSection({
  title,
  children,
  defaultOpen = false,
}: DisclosureSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        aria-expanded={open}
        className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200 ease-out",
            open && "rotate-90"
          )}
        />
        {title}
      </button>
      {open ? <div className="pt-3">{children}</div> : null}
    </div>
  );
}
