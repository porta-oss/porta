import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type {
  PortfolioBadge,
  PortfolioCardViewModel,
} from "../lib/portfolio-card";

function badgeVariant(
  badge: PortfolioBadge
): "default" | "secondary" | "destructive" | "outline" {
  switch (badge) {
    case "healthy":
      return "default";
    case "attention":
    case "syncing":
      return "secondary";
    case "blocked":
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

function trendColor(trendSummary: string): string {
  if (trendSummary.includes("+")) {
    return "text-success";
  }
  if (trendSummary.includes("-")) {
    return "text-danger";
  }
  return "text-muted-foreground";
}

export interface PortfolioStartupCardProps {
  viewModel: PortfolioCardViewModel;
}

export function PortfolioStartupCard({ viewModel }: PortfolioStartupCardProps) {
  return (
    <Card
      aria-label="portfolio startup card"
      data-testid="portfolio-startup-card"
    >
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center justify-between">
          <h3
            className="font-semibold text-lg"
            data-testid="portfolio-startup-name"
          >
            {viewModel.name}
          </h3>
          <Badge
            data-testid="portfolio-badge"
            role="status"
            variant={badgeVariant(viewModel.badge)}
          >
            {viewModel.badgeLabel}
          </Badge>
        </div>

        <div className="flex items-baseline gap-3">
          <span
            className={`font-bold text-xl tabular-nums leading-tight ${
              viewModel.badge === "blocked" || viewModel.badge === "error"
                ? "text-muted-foreground"
                : "text-foreground"
            }`}
            data-testid="portfolio-north-star"
          >
            {viewModel.northStarDisplay}
          </span>
          {viewModel.trendSummary ? (
            <span
              className={`font-medium text-sm ${trendColor(viewModel.trendSummary)}`}
              data-testid="portfolio-trend"
            >
              {viewModel.trendSummary}
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-4">
          <span
            className="text-muted-foreground text-xs"
            data-testid="portfolio-freshness"
          >
            {viewModel.freshnessCopy}
          </span>
          <span
            className="max-w-[60%] text-right text-muted-foreground text-sm"
            data-testid="portfolio-top-issue"
          >
            {viewModel.topIssue}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
