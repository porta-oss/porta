import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Wraps content with a subtle fade-in + upward shift on mount.
 * Pure CSS — no JS animation library needed.
 *
 * Uses @starting-style for entry animation (supported in modern browsers).
 * Falls back to instant display in older browsers.
 */
export function FadeIn({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("fade-in-enter", className)} {...props}>
      {children}
    </div>
  );
}
