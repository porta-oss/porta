import { Brain, Clock, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiSynthesisCardProps {
  /** Whether the AI is currently generating the synthesis. */
  loading?: boolean;
  /** ISO timestamp when the synthesis was last generated. */
  synthesizedAt?: string | null;
  /** The AI-generated cross-portfolio analysis text (rendered as markdown-like prose). */
  text?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

function isStale(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > SEVEN_DAYS_MS;
}

/**
 * Render markdown-like text as structured JSX.
 * Handles paragraphs (double newline), line breaks, bold (**text**),
 * italic (*text*), and bullet lists (lines starting with - or *).
 */
function renderMarkdownText(text: string) {
  const paragraphs = text.split(/\n{2,}/);

  return paragraphs.map((para) => {
    const trimmed = para.trim();
    if (!trimmed) {
      return null;
    }

    // Check if this paragraph is a bullet list
    const lines = trimmed.split("\n");
    const isList = lines.every(
      (line) => /^[\s]*[-*]\s/.test(line) || line.trim() === ""
    );

    if (isList) {
      return (
        <ul
          className="list-disc space-y-1 pl-4 text-muted-foreground text-sm"
          key={trimmed.slice(0, 40)}
        >
          {lines
            .filter((line) => line.trim())
            .map((line) => {
              const content = line.replace(/^[\s]*[-*]\s/, "");
              return (
                <li key={content.slice(0, 40)}>{formatInline(content)}</li>
              );
            })}
        </ul>
      );
    }

    return (
      <p className="text-muted-foreground text-sm" key={trimmed.slice(0, 40)}>
        {formatInline(trimmed.replace(/\n/g, " "))}
      </p>
    );
  });
}

/** Format inline markdown: **bold** and *italic*. */
function formatInline(text: string): Array<string | React.JSX.Element> {
  const parts: Array<string | React.JSX.Element> = [];
  // Match **bold** or *italic* — bold first to avoid conflict
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(
        <strong className="font-semibold text-foreground" key={match.index}>
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      parts.push(
        <em className="italic" key={match.index}>
          {match[3]}
        </em>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// ---------------------------------------------------------------------------
// Skeleton (loading state)
// ---------------------------------------------------------------------------

function AiSynthesisCardSkeleton() {
  return (
    <Card aria-label="Loading AI synthesis">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-32" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
        <Skeleton className="h-3 w-3/4" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Card aria-label="AI synthesis unavailable">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Brain className="size-8 text-muted-foreground/50" />
        <p className="text-muted-foreground text-sm">
          Add 2+ startups for cross-portfolio analysis
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AiSynthesisCard({
  loading,
  synthesizedAt,
  text,
}: AiSynthesisCardProps) {
  if (loading) {
    return <AiSynthesisCardSkeleton />;
  }

  if (!text) {
    return <EmptyState />;
  }

  const stale = synthesizedAt ? isStale(synthesizedAt) : false;

  return (
    <Card aria-label="AI portfolio synthesis">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-violet-500" />
          <CardTitle>Portfolio Synthesis</CardTitle>
        </div>
        <CardDescription className="flex items-center gap-2">
          {synthesizedAt ? (
            <span title={new Date(synthesizedAt).toLocaleString()}>
              <Clock className="mr-1 inline size-3" />
              Synthesized {formatRelativeTime(synthesizedAt)}
            </span>
          ) : null}
          {stale ? (
            <Badge variant="outline">
              <TriangleAlert className="size-3" />
              Stale
            </Badge>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {renderMarkdownText(text)}
      </CardContent>
    </Card>
  );
}
