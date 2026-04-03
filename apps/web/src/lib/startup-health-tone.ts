import type { HealthState } from "@shared/startup-health";

export type StartupHealthTone =
  | "healthy"
  | "attention"
  | "blocked"
  | "error"
  | "neutral";

export function toStartupHealthTone(
  state: HealthState | "load-error" | null
): StartupHealthTone {
  switch (state) {
    case "ready":
      return "healthy";
    case "stale":
      return "attention";
    case "blocked":
      return "blocked";
    case "error":
    case "load-error":
      return "error";
    default:
      return "neutral";
  }
}

export function startupIndicatorVariant(
  tone: StartupHealthTone
): "solid" | "ring" | "neutral" {
  if (tone === "error") {
    return "ring";
  }
  if (tone === "healthy" || tone === "attention" || tone === "blocked") {
    return "solid";
  }
  return "neutral";
}

export function startupRowToneClass(tone: StartupHealthTone): string {
  switch (tone) {
    case "healthy":
      return "bg-success-bg/55";
    case "attention":
      return "bg-warning-bg/55";
    case "blocked":
      return "bg-danger-bg/55";
    case "error":
      return "bg-danger-bg/35";
    default:
      return "bg-muted";
  }
}

export function portfolioCardToneClass(tone: StartupHealthTone): string {
  switch (tone) {
    case "healthy":
      return "bg-success-bg/50";
    case "attention":
      return "bg-warning-bg/50";
    case "blocked":
      return "bg-danger-bg/50";
    case "error":
      return "bg-danger-bg/35";
    default:
      return "";
  }
}
