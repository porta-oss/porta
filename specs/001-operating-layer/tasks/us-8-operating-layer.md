# Plan: US-8 — Alert Polish: Dedup + Streaks

## Overview

Alert dedup showing occurrence count badges on alert cards, healthy-streak badges (bronze/silver/gold) on portfolio cards and startup health hero section. Visual polish layer on top of the existing alert system (US-1) and dashboard modes (US-6).

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: All Wave 3 stories depend on Wave 1+2 being complete. US-8 specifically depends on US-1 (alert system with dedup and streak tracking already in DB) and US-6 (dashboard components that display alerts).

**Existing patterns**:
- Frontend: shadcn/ui components, TanStack Router file-based routing, protected routes under `src/routes/_authenticated/`
- Path aliases: `@/` maps to `src/` within each app, `@shared/` maps to `packages/shared/src/`
- Alert dedup: DB already tracks `occurrence_count` on alert rows (US-1 evaluator increments on re-fire)
- Streak tracking: DB `streak` table with `current_days`, `longest_days`, `started_at`, `broken_at` (US-1 post-sync pipeline updates)

**Streak badges**: 16px circular progress ring (SVG). Three tiers:
- Bronze (>=7 days): amber color
- Silver (>=14 days): gray color
- Gold (>=30 days): gold color
- No badge displayed if streak <7 days

**Dedup display**: "fired 3x this week" pill badge on alert cards in decision surface and journal alert events. Only shown when `occurrenceCount > 1`.

**Alert rule row**: Compact display of alert rule configuration with metric key, human-readable condition, threshold, severity badge, and enabled/disabled toggle. Used in alert management views.

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Create streak badge component
File: `apps/web/src/components/streak-badge.tsx`
- [x] 16px circular progress ring (inline SVG, `viewBox="0 0 16 16"`)
- [x] Three tiers: bronze (>=7 days, amber stroke), silver (>=14 days, gray stroke), gold (>=30 days, gold stroke)
- [x] Progress ring fill: `current_days / tier_threshold` (capped at 1.0 for full ring)
- [x] Show current streak day count inside ring (text element, centered)
- [x] Tooltip on hover: "X day healthy streak" via shadcn Tooltip
- [x] No badge rendered if streak <7 days (return null)
- [x] Accept `streakDays: number` prop

### Task 2: Create alert rule row component
File: `apps/web/src/components/alert-rule-row.tsx`
- [x] Display: metric key (human-readable label from universal metrics map), condition (formatted: "drops >20% week-over-week"), threshold value with unit, severity badge
- [x] Severity color coding: critical = red, high = orange, medium = yellow, low = blue
- [x] Enabled/disabled toggle switch (shadcn Switch)
- [x] `onToggle` callback prop for enable/disable
- [x] `onClick` callback prop for navigation to alert rule edit
- [x] Compact row layout suitable for list display

### Task 3: Integrate streak badges into dashboard
File: `apps/web/src/routes/_authenticated/dashboard-startup.tsx`
- [x] Fetch streak data for current startup from streak endpoint
- [x] Display `StreakBadge` in startup health hero section (next to health state badge)
- [x] Display `StreakBadge` on portfolio startup cards (in Decide mode startup list)
- [x] Handle loading state (skeleton placeholder for badge area)
- [x] Handle no streak data (no badge rendered)

### Task 4: Display alert dedup badges
File: `apps/web/src/components/decision-surface.tsx`
- [ ] Show occurrence count badge on alert cards when `occurrenceCount > 1`
- [ ] Badge text: "fired Nx this week" (e.g., "fired 3x this week")
- [ ] Style: small pill badge, muted background color, compact font
- [ ] Position: below alert metric info, before action buttons
- [ ] Also render dedup badge in Journal mode alert event entries (in `event-log-entry.tsx` alert event variant)
