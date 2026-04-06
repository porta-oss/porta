# Plan: Polish — Cross-Cutting Concerns

## Overview

Final quality pass affecting multiple user stories. Covers stale data handling, responsive layout, linting compliance, type safety, and quickstart flow validation. This phase runs after all Wave 3 stories (US-6, US-7, US-8) are complete and ensures the Operating Layer is production-ready for dogfood deployment.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: All Wave 1, Wave 2, and Wave 3 user stories must be complete before this phase.

**Existing patterns**:
- Frontend: shadcn/ui components, TanStack Router file-based routing, protected routes under `src/routes/_authenticated/`
- Path aliases: `@/` maps to `src/` within each app, `@shared/` maps to `packages/shared/src/`
- Linting: Ultracite/Biome config in `biome.jsonc`, extends `ultracite/biome/{core,react,vitest}`
- Git hooks: Lefthook pre-commit (Biome check on staged files + typecheck), pre-push (full Vitest suite)
- Quickstart: `specs/001-operating-layer/quickstart.md` documents the full local dev setup flow

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Add stale data handling
File: `apps/web/src/routes/_authenticated/dashboard.tsx`
- [x] Set `staleTime` and `gcTime` on all dashboard TanStack Query hooks (stale-while-revalidate strategy)
- [x] Create "Last updated X min ago" badge component (relative timestamp, updates every 30s)
- [x] Display badge on each data section (alerts, events, metrics, comparison matrix)
- [x] When data is >5 min old: show subtle warning badge (amber text)
- [x] When data is >30 min old: show prominent stale warning (red background, "Data may be outdated" message)
- [x] Offline detection: listen to `navigator.onLine` changes via `useEffect`
- [x] When offline: show persistent banner at top of dashboard ("You are offline. Data may not be current.")
- [x] When back online: auto-refetch all queries via `queryClient.invalidateQueries()`

### Task 2: Implement responsive layout
File: `apps/web/src/routes/_authenticated/dashboard.tsx`
- [x] Mobile (<768px): move mode switcher tabs to fixed bottom bar
- [x] Mobile: collapsible sidebar (hamburger menu trigger)
- [x] Mobile Compare mode: stacked cards layout instead of horizontal matrix table
- [x] Tablet (768-1024px): compact sidebar with icon-only mode
- [x] Ensure all touch targets are minimum 44x44px (buttons, tabs, toggle switches)
- [x] Test decision surface action buttons stack vertically on mobile
- [x] Test event filter bar wraps gracefully on narrow screens

### Task 3: Run Biome/Ultracite compliance
- [ ] Run `pnpm check` across all workspaces
- [ ] Fix any lint/format issues with `pnpm fix`
- [ ] Verify no new warnings introduced by Wave 3 code
- [ ] Ensure all new component files follow Biome import ordering rules

### Task 4: Run TypeScript typecheck
- [ ] Run `pnpm typecheck` across all workspaces
- [ ] Fix any type errors in `apps/api`, `apps/web`, `apps/worker`, `packages/shared`
- [ ] Verify no `any` types in new Wave 3 code (use `unknown` where type is genuinely unknown)
- [ ] Verify all shared Zod schemas infer correct TypeScript types

### Task 5: Validate quickstart flow
- [ ] Run `pnpm services:up` (Docker Compose for Postgres + Redis)
- [ ] Run migrations: `bun run --cwd apps/api src/db/migrate.ts`
- [ ] Start dev servers: `pnpm dev` (API + Web concurrently)
- [ ] Run full test suite: `pnpm test`
- [ ] Run E2E smoke test if available: `pnpm test:e2e:onboarding`
- [ ] Verify all three dashboard modes load without console errors
- [ ] Verify mode switching via keyboard shortcuts (Cmd+1/2/3) works
- [ ] Verify URL persistence (`?mode=journal` survives refresh)
- [ ] Run `pnpm services:down` to clean up
