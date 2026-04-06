import { useEffect, useState } from "react";

function canMatchMedia(): boolean {
  return (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    canMatchMedia() ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (!canMatchMedia()) {
      return;
    }
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** True when viewport is below 768px (Tailwind `md` breakpoint). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** True when viewport is between 768px and 1023px (tablet range). */
export function useIsTablet(): boolean {
  return useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
}
