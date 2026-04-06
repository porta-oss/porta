# Plan: US-6 — Dashboard Operating Modes

## Overview

Three dashboard modes (Decide/Journal/Compare) with keyboard shortcuts (Cmd+1/2/3), URL state persistence (?mode=decide|journal|compare), responsive layout. Each mode provides a distinct interaction surface for daily startup operations.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: All Wave 3 stories depend on Wave 1+2 being complete (US-1 alerts, US-4 event log, US-5 connectors, US-2 Telegram, US-3 MCP, US-9 webhooks).

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- Frontend: shadcn/ui components, TanStack Router file-based routing, protected routes under `src/routes/_authenticated/`
- Path aliases: `@/` maps to `src/` within each app, `@shared/` maps to `packages/shared/src/`

**Mode Switcher**: Tab component with `role="tablist"`, Cmd+1/2/3 keyboard shortcuts. URL param `?mode=` persists state on refresh. Default mode: `decide`.

**Decide Mode**: Shows top-priority alert with inline actions (ack/snooze/investigate). Metrics grid below. Zero-alert state: "All clear" with streak badge. Alerts sorted by severity (critical > high > medium > low), then `firedAt` descending.

**Journal Mode**: Chronological event log entries with day separators. Filter bar (event type checkboxes + date range). Cursor pagination "Load more" button. Scroll-to-event via URL param `?event={id}` (retry 2x with 2s delay, expiry handling for >90d events).

**Compare Mode**: Single batch endpoint for all startups. 60s `staleTime` cache in TanStack Query. Startup comparison matrix (rows = startups, columns = universal metrics: MRR, Active Users, Churn Rate, Error Rate, Growth Rate, ARPU). AI synthesis card. Expandable per-source detail. Graceful fallback for <2 startups.

**Components to create** (all shadcn/ui based):
- `mode-switcher.tsx` — tabs with keyboard shortcuts
- `decision-surface.tsx` — top alert card with actions
- `event-log-entry.tsx` — per-event-type rendering
- `day-separator.tsx` — date headers
- `event-filter.tsx` — type checkboxes + date range
- `comparison-matrix.tsx` — startup grid
- `ai-synthesis-card.tsx` — AI insight display
- `system-status-section.tsx` — sidebar status (last digest, MCP count, alerts)

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Create mode switcher component
File: `apps/web/src/components/mode-switcher.tsx`
- [x] Three tabs: Decide, Journal, Compare
- [x] `role="tablist"` with `role="tab"` for each tab button
- [x] Keyboard shortcuts: Cmd+1 (Decide), Cmd+2 (Journal), Cmd+3 (Compare)
- [x] Active tab styling via shadcn Tabs component
- [x] `onChange` callback prop for parent to switch mode
- [x] `value` prop for controlled mode selection
- [x] `useEffect` to register/cleanup keyboard listeners on mount/unmount
- [x] Prevent shortcut firing when focus is inside an input/textarea

### Task 2: Create decision surface component
File: `apps/web/src/components/decision-surface.tsx`
- [x] Display highest-priority alert (sorted by severity, then firedAt)
- [x] Alert card with: severity badge, metric key, current value, threshold, fired time
- [x] Inline action buttons: Ack, Snooze (with duration picker), Investigate (navigates to journal with `?event={id}`)
- [x] Zero-alert state: "All clear" message with streak badge and celebration styling
- [x] Loading skeleton state while fetching alerts
- [x] Error state with retry button

### Task 3: Create event log entry component
File: `apps/web/src/components/event-log-entry.tsx`
- [ ] Render based on `eventType` discriminated union from `@shared/event-log`
- [ ] Alert events: severity icon + metric + value + action taken
- [ ] Connector events: provider icon + sync duration/error
- [ ] Insight events: insight summary + severity
- [ ] Telegram/MCP/task/webhook events: appropriate icons + key details
- [ ] Timestamp display (relative: "2h ago", absolute on hover via tooltip)

### Task 4: Create day separator component
File: `apps/web/src/components/day-separator.tsx`
- [ ] Date header with formatted date (e.g., "Monday, April 3")
- [ ] Horizontal rule styling with date centered
- [ ] "Today" and "Yesterday" labels for recent dates
- [ ] Muted text color for separator styling

### Task 5: Create event filter bar component
File: `apps/web/src/components/event-filter.tsx`
- [ ] Event type checkboxes grouped by category (alert, connector, insight, telegram, mcp, task, webhook)
- [ ] "Show all" toggle (default off: only alert + insight + task selected)
- [ ] Date range picker (from/to) using shadcn DatePicker
- [ ] Apply filters callback prop
- [ ] Reset filters button
- [ ] Compact horizontal layout

### Task 6: Create comparison matrix component
File: `apps/web/src/components/comparison-matrix.tsx`
- [ ] Table: rows = startups, columns = universal metrics (MRR, Active Users, Churn Rate, Error Rate, Growth Rate, ARPU)
- [ ] Cell values with delta indicators (green arrow up, red arrow down, gray dash for no change)
- [ ] Expandable row detail showing per-source custom metrics
- [ ] Sort by column (click column header to toggle asc/desc)
- [ ] Health state badge per startup row
- [ ] Empty state for no startups

### Task 7: Create AI synthesis card component
File: `apps/web/src/components/ai-synthesis-card.tsx`
- [ ] Display AI-generated cross-startup analysis text (markdown rendered)
- [ ] "Synthesized at" timestamp with relative time
- [ ] Loading state with skeleton (while AI generates)
- [ ] Empty state: "Add 2+ startups for cross-portfolio analysis"
- [ ] Subtle card styling with AI indicator icon
- [ ] Stale indicator if synthesis is >7 days old

### Task 8: Create system status sidebar section
File: `apps/web/src/components/system-status-section.tsx`
- [ ] Last digest sent timestamp (relative: "2h ago")
- [ ] MCP query count (today)
- [ ] Active alert count with severity breakdown
- [ ] Connector sync status (last sync time, any errors flagged)
- [ ] Compact sidebar format with icon + label + value rows

### Task 9: Integrate mode switcher with URL persistence
File: `apps/web/src/routes/_authenticated/dashboard.tsx`
- [ ] Read `?mode=` search param on mount (default: `'decide'`)
- [ ] Validate mode is one of `decide | journal | compare`
- [ ] Update URL search param on mode change via TanStack Router `navigate`
- [ ] Render `ModeSwitcher` with current mode as controlled value
- [ ] Conditionally render mode content based on current mode
- [ ] Register Cmd+1/2/3 keyboard shortcuts via `useEffect`

### Task 10: Implement Decide mode
File: `apps/web/src/routes/_authenticated/dashboard.tsx`
- [ ] Fetch active alerts for current startup via `GET /api/startups/:startupId/alerts?status=active` (TanStack Query)
- [ ] Sort by severity (critical > high > medium > low), then `firedAt` descending
- [ ] Render `DecisionSurface` with top alert
- [ ] Metrics grid below with universal metrics from health snapshot
- [ ] Zero-alert state with streak badge (fetch from streak endpoint)
- [ ] Triage actions call `POST /api/alerts/:id/triage`
- [ ] Invalidate alerts query on successful triage

### Task 11: Implement Journal mode
File: `apps/web/src/routes/_authenticated/dashboard.tsx`
- [ ] Fetch events via `GET /api/events` with filters (TanStack Query)
- [ ] Render `EventFilterBar` with filter state
- [ ] Group events by day, render `DaySeparator` between groups
- [ ] Render `EventLogEntry` for each event
- [ ] "Load more" button triggers cursor pagination (pass `cursor` from last response)
- [ ] Scroll-to-event: if `?event=` param present, find event in loaded list
- [ ] If event not found in current page, retry fetch 2x with 2s delay between
- [ ] If still not found after retries: show "Event not found or expired" toast
- [ ] If event timestamp is >90 days old: show "This event has been archived" toast

### Task 12: Implement Compare mode
File: `apps/web/src/routes/_authenticated/dashboard.tsx`
- [ ] Fetch all startups with metrics via batch endpoint (TanStack Query)
- [ ] 60s `staleTime` client-side cache
- [ ] Render `ComparisonMatrix` with startup data
- [ ] Render `AiSynthesisCard` with portfolio summary from stored AI synthesis
- [ ] Handle <2 startups: show per-startup summary card instead of matrix
- [ ] Render `SystemStatusSection` in sidebar
