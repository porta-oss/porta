# Alert Rule Contracts

**Spec ref**: US-1, US-8

## CRUD API

### Create alert rule

**Route**: `POST /api/startups/:startupId/alert-rules`

```typescript
// Input
{
  metricKey: string;          // Any universal or custom metric key
  condition: "drop_wow_pct" | "spike_vs_avg" | "below_threshold" | "above_threshold";
  threshold: number;          // > 0, max 10000
  severity?: "critical" | "high" | "medium" | "low"; // Default "medium"
  enabled?: boolean;          // Default true
  minDataPoints?: number;     // Default 7, min 1, max 365
}

// Response: 201
{
  id: string;
  startupId: string;
  metricKey: string;
  condition: string;
  threshold: number;
  severity: string;
  enabled: boolean;
  minDataPoints: number;
  createdAt: string;
  updatedAt: string;
}
```

**Validation**:
- `threshold` > 0, max 10000
- Percentage conditions (`drop_wow_pct`): threshold capped at 100
- Multiplier conditions (`spike_vs_avg`): threshold capped at 100
- `metricKey`: non-empty, max 100 chars
- Unique constraint: `(startupId, metricKey, condition)` — 409 on conflict

### List alert rules

**Route**: `GET /api/startups/:startupId/alert-rules`

Returns all rules for the startup. No pagination (expected <50 rules per startup).

### Update alert rule

**Route**: `PATCH /api/startups/:startupId/alert-rules/:ruleId`

Partial update. Same validation as create.

### Delete alert rule

**Route**: `DELETE /api/startups/:startupId/alert-rules/:ruleId`

Cascades to associated fired alerts.

## Alert Triage API

### List alerts

**Route**: `GET /api/startups/:startupId/alerts`

```typescript
// Query params
{
  status?: "active" | "acknowledged" | "snoozed" | "dismissed" | "resolved";
}

// Response: Alert[]
```

### Triage alert

**Route**: `POST /api/alerts/:alertId/triage`

```typescript
// Input
{
  action: "ack" | "snooze" | "dismiss";
  snoozeDurationHours?: number; // For snooze, default 24, max 168
}

// Response: updated Alert
```

### Bulk triage (US-1: "Ack all" / "Snooze all")

**Route**: `POST /api/startups/:startupId/alerts/bulk-triage`

```typescript
// Input
{
  action: "ack" | "snooze" | "dismiss";
  alertIds?: string[];         // Specific alerts, or omit for all active
  snoozeDurationHours?: number;
}

// Response
{
  triaged: number;            // Count of alerts updated
}
```

## Alert Evaluation Engine

**Trigger**: Post-sync, after health snapshot recompute. Not on cron.

**Pipeline**: `sync → snapshot → evaluateAlerts() → notify`

**Timeout**: 30 seconds per startup. On timeout: log error event, continue pipeline.

### Evaluation Algorithm

For each enabled `alert_rule` for the startup:

1. **Look up metric value**: Check universal metrics first, then custom metrics
2. **Skip if metric not found**: Connector not yet providing this data — silent skip
3. **Load history**: Query `health_snapshot_history` for this `(startup_id, metric_key)` within 30-day rolling window
4. **Skip if insufficient data**: If `history.length < rule.minDataPoints` — skip
5. **Evaluate condition**:

```
drop_wow_pct:
  current = latest value
  previous = value from 7 days ago (nearest snapshot)
  drop_pct = ((previous - current) / previous) * 100
  FIRE if drop_pct >= threshold AND z_score(current, history) >= 2.5

spike_vs_avg:
  current = latest value
  mean = avg(history values)
  ratio = current / mean
  FIRE if ratio >= threshold AND z_score(current, history) >= 2.5

below_threshold:
  FIRE if current < threshold

above_threshold:
  FIRE if current > threshold
```

6. **Z-score guard** (for `drop_wow_pct` and `spike_vs_avg`):
```
z_score = |current - mean| / stddev
FIRE only if z_score >= 2.5
```
This prevents false positives on small/noisy data.

7. **Edge cases**:
   - Zero base value: skip `drop_wow_pct` (can't compute percentage of zero)
   - Constant values (SD = 0): skip Z-score guard (every deviation is infinite Z-score)
   - Negative values: use absolute values for Z-score computation

### Alert Dedup (US-8)

When an alert fires:
1. Check for existing `active` or `snoozed` alert for same `(rule_id, startup_id)`
2. If exists: increment `occurrence_count`, update `last_fired_at` — no new row
3. If not: create new alert row

### Default Alert Seeding

After first successful sync, seed alerts based on which metrics arrived:

| Metric Key | Condition | Threshold | Severity |
|------------|-----------|-----------|----------|
| `mrr` | `drop_wow_pct` | 20 | critical |
| `active_users` | `drop_wow_pct` | 25 | high |
| `churn_rate` | `above_threshold` | 10 | high |
| `error_rate` | `spike_vs_avg` | 3 | critical |
| `yookassa_failed_payments` | `spike_vs_avg` | 2 | high |
| `active_installs` | `drop_wow_pct` | 25 | high |
| `active_families` | `drop_wow_pct` | 25 | high |

Only seed for metrics that exist after sync. Don't seed for unknown custom metrics.

## Streak Tracking (US-8)

**Updated post-evaluation:**
- If zero active alerts for startup: increment `streak.current_days` (once per day)
- If any alert fires: reset `streak.current_days = 0`, set `streak.broken_at = now()`
- Track `streak.longest_days = max(current, longest)`

**Badge thresholds**: 7+ bronze, 14+ silver, 30+ gold
