# Plan: US-2 — Telegram Push Notifications

## Overview

Telegram bot sends daily digests with sparkline PNGs and immediate anomaly alerts with inline keyboard triage buttons. Setup via BotFather token entry, 6-digit verification code, and `/start <code>` linking. Uses grammY for bot framework, resvg-js for sparkline SVG-to-PNG rendering.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: All Wave 2 stories depend on Wave 1 (US-1 alerts + US-4 events + US-5 connectors being complete).

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- DB schema: `pgTable()` with camelCase TS -> snake_case DB columns
- Shared types: const arrays + union types, Summary interfaces, Zod schemas
- Queue names: UPPERCASE_SNAKE_CASE constants
- TDD: Write failing tests first, then implement

**Setup flow**:
1. User enters bot token in dashboard settings
2. System generates 6-digit verification code (15 min expiry)
3. User sends `/start <code>` to bot in Telegram
4. Bot verifies code, links `chat_id`, sets `is_active=true`

**Routes**:
- `POST /api/workspace/telegram` -- setup (botToken, digestTime, digestTimezone) -> returns verificationCode + botUsername
- `DELETE /api/workspace/telegram` -- unlink

**Daily Digest** (BullMQ repeatable at configured time):
- Per workspace, at `digest_time` in `digest_timezone`
- Per startup: health state, north star value + delta, sparkline PNG (200x50px), active alerts, at-risk customers
- Sparkline: SVG -> PNG via resvg-js, 5s timeout, text fallback with Unicode arrows
- Send via Telegram `sendMessage` + `sendPhoto`
- Telegram MarkdownV2 formatting

**Alert Notification** (immediate on alert fire):
- Message with severity, startup name, metric, value, threshold, occurrence count
- Inline keyboard buttons: Ack, Snooze, Dismiss (`callback_data: triage:action:alertId`)
- Deep link to journal mode

**Callback handling** (grammY):
- Parse `callback_data` -> extract action + alertId
- Update alert status in DB
- Answer callback query with confirmation
- Edit message to remove keyboard (prevent double-triage)
- Log `telegram.reaction` event

**Frontend**: Settings page at `/settings/telegram` with BotFather guide, token entry, verification code display, digest time/timezone config.

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Implement Telegram config routes
File: `apps/api/src/routes/telegram.ts`
- [x] `POST /api/workspace/telegram` -- validate botToken format (`/^\d+:[A-Za-z0-9_-]{35}$/`), fetch bot info (`getMe`), generate 6-digit verification code, store in `telegram_config` with 15-min expiry, return code + botUsername
- [x] `DELETE /api/workspace/telegram` -- clear `chat_id`, set `is_active=false`

### Task 2: Implement Telegram webhook handler
File: `apps/api/src/routes/telegram.ts` (same file)
- [x] Use grammY `webhookCallback` to handle incoming Telegram updates
- [x] Handle `/start <code>` command: look up `telegram_config` by `verification_code`, check expiry, set `chat_id` + `is_active=true`, reply "Linked!"
- [x] Handle expired/invalid code: reply "Invalid or expired code"

### Task 3: Implement inline keyboard triage callback
File: `apps/api/src/routes/telegram.ts` (same file)
- [x] Handle `callback_query` events
- [x] Parse `callback_data` format: `triage:ack|snooze|dismiss:alertId`
- [x] Look up alert, update status (`ack` -> `acknowledged`, `snooze` -> `snoozed` with `snoozedUntil` +24h, `dismiss` -> `dismissed`)
- [x] Answer callback query with confirmation text
- [x] Edit original message to remove inline keyboard
- [x] Emit `telegram.reaction` event via emitter

### Task 4: Implement sparkline generation
File: `apps/worker/src/sparklines.ts`
- [x] Create `renderSparkline(values: number[], width?: number, height?: number): Promise<Buffer>`
- [x] Generate SVG path from values (200x50px default)
- [x] Convert SVG to PNG via `@resvg/resvg-js`
- [x] 5s timeout via AbortController
- [x] On timeout/error: return null (caller uses text fallback)

### Task 5: Implement daily digest processor
File: `apps/worker/src/processors/telegram.ts`
- [x] Create processor for `TELEGRAM_QUEUE` (digest job type)
- [x] Query active `telegram_configs` where current time matches `digest_time` in `digest_timezone`
- [x] Per workspace: load all startups with health snapshots, alerts, at-risk customers
- [x] Per startup: render sparkline PNG (7-day north star trend)
- [x] Format MarkdownV2 message with health state, metrics, alerts, customers
- [x] Send via Telegram Bot API: `sendPhoto` (sparkline) then `sendMessage` (details)
- [x] Update `last_digest_at`
- [x] Log `telegram.digest` event
- [x] Handle 403 (bot removed): set `is_active=false`

### Task 6: Implement alert notification processor
File: `apps/worker/src/processors/telegram.ts` (same file)
- [x] Create handler for alert notification job type
- [x] Format alert message: severity, startup name, metric, value, threshold, occurrence count
- [x] Build InlineKeyboard with Ack/Snooze/Dismiss buttons
- [x] Send via `sendMessage` with `reply_markup`
- [x] Include deep link to journal mode: `{dashboardUrl}?startup={id}&mode=journal&event={eventId}`
- [x] Log `telegram.alert` event

### Task 7: Create Telegram settings page
File: `apps/web/src/routes/_authenticated/settings/telegram.tsx`
- [x] BotFather setup instructions (step-by-step guide)
- [x] Bot token input field with format validation
- [x] After setup: show verification code and instructions ("Send `/start {code}` to @{botname}")
- [x] Connected state: show bot name, chat linked status, digest time/timezone pickers
- [x] Unlink button with confirmation
- [x] Digest time picker (HH:MM) and timezone selector

### Task 8: Register Telegram routes in app
File: `apps/api/src/app.ts`
- [ ] Import Telegram route handlers
- [ ] Add POST/DELETE `/api/workspace/telegram` with session auth
- [ ] Add Telegram webhook endpoint (no session auth -- Telegram calls this)
- [ ] Wire `TelegramRuntime` with db + bot instance
