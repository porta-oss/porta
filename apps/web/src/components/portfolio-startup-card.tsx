// Portfolio-first startup representation card.
// Renders the startup as a founder-readable surface with health badge,
// trend summary, freshness label, and top-issue context.

import type {
  PortfolioBadge,
  PortfolioCardViewModel,
} from "../lib/portfolio-card";

// ---------------------------------------------------------------------------
// Style mappings
// ---------------------------------------------------------------------------

interface BadgeStyle {
  bg: string;
  border: string;
  color: string;
}

const BADGE_STYLES: Record<PortfolioBadge, BadgeStyle> = {
  healthy: { color: "#065f46", bg: "#ecfdf5", border: "#a7f3d0" },
  attention: { color: "#92400e", bg: "#fffbeb", border: "#fde68a" },
  blocked: { color: "#991b1b", bg: "#fef2f2", border: "#fecaca" },
  syncing: { color: "#1e40af", bg: "#eff6ff", border: "#bfdbfe" },
  error: { color: "#991b1b", bg: "#fef2f2", border: "#fecaca" },
  unknown: { color: "#374151", bg: "#f9fafb", border: "#e5e7eb" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PortfolioStartupCardProps {
  viewModel: PortfolioCardViewModel;
}

export function PortfolioStartupCard({ viewModel }: PortfolioStartupCardProps) {
  const style = BADGE_STYLES[viewModel.badge];

  return (
    <section
      aria-label="portfolio startup card"
      data-testid="portfolio-startup-card"
      style={{
        display: "grid",
        gap: "0.75rem",
        padding: "1.25rem",
        border: `1px solid ${style.border}`,
        borderRadius: "1rem",
        background: "#ffffff",
      }}
    >
      {/* Header row: name + badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3
          data-testid="portfolio-startup-name"
          style={{
            margin: 0,
            fontSize: "1.1rem",
            fontWeight: 600,
            color: "#111827",
          }}
        >
          {viewModel.name}
        </h3>
        <span
          data-testid="portfolio-badge"
          role="status"
          style={{
            fontSize: "0.7rem",
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            padding: "0.2rem 0.6rem",
            borderRadius: "9999px",
            color: style.color,
            background: style.bg,
          }}
        >
          {viewModel.badgeLabel}
        </span>
      </div>

      {/* Metrics row: north-star value + trend */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
        <span
          data-testid="portfolio-north-star"
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color:
              viewModel.badge === "blocked" || viewModel.badge === "error"
                ? "#9ca3af"
                : "#111827",
          }}
        >
          {viewModel.northStarDisplay}
        </span>
        {viewModel.trendSummary ? (
          <span
            data-testid="portfolio-trend"
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: (() => {
                if (viewModel.trendSummary.includes("+")) {
                  return "#065f46";
                }
                if (viewModel.trendSummary.includes("-")) {
                  return "#991b1b";
                }
                return "#6b7280";
              })(),
            }}
          >
            {viewModel.trendSummary}
          </span>
        ) : null}
      </div>

      {/* Bottom row: freshness + top issue */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <span
          data-testid="portfolio-freshness"
          style={{ fontSize: "0.75rem", color: "#6b7280" }}
        >
          {viewModel.freshnessCopy}
        </span>
        <span
          data-testid="portfolio-top-issue"
          style={{
            fontSize: "0.8rem",
            color: style.color,
            textAlign: "right",
            maxWidth: "60%",
          }}
        >
          {viewModel.topIssue}
        </span>
      </div>
    </section>
  );
}
