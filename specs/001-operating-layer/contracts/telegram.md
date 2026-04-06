# Telegram Bot Contracts

**Spec ref**: US-2

## Setup Flow

### 1. Bot token entry (dashboard)

**Route**: `POST /api/workspace/telegram`

```typescript
// Input
{
  botToken: string;           // From BotFather
  digestTime: string;         // HH:MM, default "09:00"
  digestTimezone: string;     // IANA timezone
}

// Response
{
  verificationCode: string;   // 6-digit code, expires in 15 minutes
  botUsername: string;         // For display: "Send /start <code> to @botname"
}
```

### 2. Verification via /start command

User sends `/start <code>` to the bot in Telegram.

**Bot receives** (via webhook or polling):
```json
{
  "message": {
    "chat": { "id": 123456789 },
    "text": "/start abc123",
    "from": { "id": 987654321 }
  }
}
```

**Bot behavior**:
1. Parse verification code from `/start` command
2. Look up `telegram_config` where `verification_code = <code>` AND `verification_expires_at > now()`
3. If found: set `chat_id`, set `is_active = true`, clear verification code
4. Reply: "Linked! You'll receive daily digests at {time} {tz}."
5. If not found or expired: reply "Invalid or expired code. Generate a new one in the dashboard."
6. Log `telegram.linked` event

### 3. Unlinking (dashboard)

**Route**: `DELETE /api/workspace/telegram`

Clears `chat_id`, sets `is_active = false`. Stops all delivery.

## Daily Digest Message

**Trigger**: BullMQ repeatable job at configured `digest_time` in `digest_timezone`.

**Message format** (Telegram MarkdownV2):
```
📊 *Porta Daily Brief* — {date}

*{startup1.name}* ({startup1.type})
Health: {healthState} {streakBadge}
⭐ {northStarKey}: {value} ({delta})
{sparklineImage}

⚠️ *Alerts*: {activeAlertCount}
{alert1: severity + metric + value}

👥 *Customers to call*: {atRiskCount}
{customer1: name + risk reason}

---
*{startup2.name}* ...

🔗 [Open Dashboard]({dashboardUrl})
```

**Sparklines**: 200x50px PNG via resvg-js. One per startup showing 7-day north star trend.
- Render timeout: 5 seconds per image via AbortController
- Fallback: text-only with Unicode arrows (↑↓→) if render fails
- Sent via `sendPhoto` with caption

**Delivery**: Via Telegram Bot API `sendMessage` / `sendPhoto`.

## Anomaly Alert Message

**Trigger**: Immediately when an alert fires (post-sync evaluation).

```
🚨 *Alert: {severity}*

*{startupName}* — {metricKey}
{condition description}: {value} (threshold: {threshold})
Fired {occurrenceCount}x this week

[View in Journal]({dashboardUrl}?startup={id}&mode=journal&event={eventId})
```

**Deep link**: URL points to Journal mode with event scroll-to via URL parameter.

## Inline Keyboard Triage

> **Spec deviation**: US-2 specifies emoji reactions (👍/😴/❌), but Telegram Bot API does not support `message_reaction` in private DM chats (bot cannot be admin in 1:1 conversations). Inline keyboard buttons provide equivalent one-tap triage UX.

**Inline keyboard** attached to each alert message:

| Button | Callback Data | Effect |
|--------|--------------|--------|
| `Ack` | `triage:ack:{alertId}` | Set alert status → `acknowledged` |
| `Snooze` | `triage:snooze:{alertId}` | Set alert status → `snoozed`, `snoozed_until = now + 24h` |
| `Dismiss` | `triage:dismiss:{alertId}` | Set alert status → `dismissed` |

**Implementation** (grammY):
```typescript
import { InlineKeyboard } from "grammy";

const keyboard = new InlineKeyboard()
  .text("Ack", `triage:ack:${alertId}`)
  .text("Snooze", `triage:snooze:${alertId}`)
  .text("Dismiss", `triage:dismiss:${alertId}`);

await telegram.sendMessage(chatId, alertText, {
  parse_mode: "HTML",
  reply_markup: keyboard,
});
```

**Behavior**:
- Bot receives `callback_query` update when user taps a button
- Parse `callback_data` to extract action and alertId
- Apply triage action, update alert status in DB
- Answer callback query: `ctx.answerCallbackQuery("Alert acknowledged")`
- Edit original message to remove keyboard (prevent double-triage)
- Log `telegram.reaction` event with action and alert_id

## Error Handling

| Failure | Detection | Response |
|---------|-----------|----------|
| API down (5xx) | HTTP status | BullMQ retry: 1m, 5m, 15m, 60m. After 4: log + skip |
| Rate limited (429) | `Retry-After` header | BullMQ delayed retry respecting `Retry-After` |
| Bot removed (403) | HTTP 403 Forbidden | Set `is_active = false`, log event, stop delivery |
| Sparkline failure | try/catch | Text-only fallback with Unicode arrows |
| Chat not found | HTTP 400 | Set `is_active = false`, log event |
