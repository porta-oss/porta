import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StreakBadgeProps {
  className?: string;
  streakDays: number;
}

function getTier(days: number) {
  if (days >= 30) {
    return { label: "Gold", threshold: 30, stroke: "#EAB308" };
  }
  if (days >= 14) {
    return { label: "Silver", threshold: 14, stroke: "#9CA3AF" };
  }
  if (days >= 7) {
    return { label: "Bronze", threshold: 7, stroke: "#F59E0B" };
  }
  return null;
}

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = 8;

export function StreakBadge({ streakDays, className }: StreakBadgeProps) {
  const tier = getTier(streakDays);
  if (!tier) {
    return null;
  }

  const progress = Math.min(streakDays / tier.threshold, 1.0);
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={className} style={{ display: "inline-flex" }}>
            <svg
              aria-label={`${String(streakDays)} day healthy streak (${tier.label})`}
              fill="none"
              height={16}
              viewBox="0 0 16 16"
              width={16}
            >
              <circle
                cx={CENTER}
                cy={CENTER}
                opacity={0.15}
                r={RADIUS}
                stroke="currentColor"
                strokeWidth={2}
              />
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                stroke={tier.stroke}
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                strokeWidth={2}
                transform={`rotate(-90 ${String(CENTER)} ${String(CENTER)})`}
              />
              <text
                dominantBaseline="central"
                fill={tier.stroke}
                fontSize={7}
                fontWeight={600}
                textAnchor="middle"
                x={CENTER}
                y={CENTER}
              >
                {streakDays}
              </text>
            </svg>
          </span>
        </TooltipTrigger>
        <TooltipContent>{String(streakDays)} day healthy streak</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
