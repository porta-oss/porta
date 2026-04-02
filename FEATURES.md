# Porta — v1 feature breakdown

## Release goal

Ship a usable first version for founders running 2–10 startups that:

* connects core sources,
* shows one portfolio view,
* highlights broken funnels and KPI changes,
* turns insights into tasks.

v1 should answer one question well:

**“Which startup needs attention today, and what should I do next?”**

## v1 scope

Included:

* multi-startup workspace
* startup setup and KPI templates
* connectors for a narrow core stack
* portfolio dashboard
* startup health pages
* alerts and AI summaries
* task creation
* weekly founder brief

Excluded:

* custom dashboard builder
* full CRM
* full social publishing
* autonomous agents taking actions without approval
* advanced permissions/admin

---

## Epic 1 — Workspace and startup management

### Feature

Create one workspace with multiple startups inside it.

### User stories

* As a founder, I can create a workspace so all my products live in one account.
* As a founder, I can add multiple startups so I can track Triggo, Heymily, and a widget factory separately.
* As a founder, I can assign a startup type so the product knows which KPIs matter.
* As a founder, I can archive a startup without deleting historical data.

### Acceptance criteria

* User can create a workspace after signup.
* User can create, edit, archive, and unarchive startups.
* Each startup has: name, type, stage, timezone, currency, and default KPI template.
* Supported startup types in v1:

  * B2B SaaS
  * consumer app
  * plugin/widget/app business
* Archived startups do not appear in default portfolio view but remain accessible.

---

## Epic 2 — Guided onboarding and connector setup

### Feature

Connect core systems and map them to each startup.

### User stories

* As a founder, I can connect data sources for each startup so the dashboard populates automatically.
* As a founder, I can skip a connector and add it later.
* As a founder, I can see connection health so I know whether the numbers are trustworthy.

### v1 connectors

* Postgres
* Stripe
* one product analytics source: PostHog first
* CSV upload
* webhook/API ingestion
* Linear integration for task creation

Nice-to-have if time remains:

* Shopify
* HubSpot or Pipedrive, but only one

### Acceptance criteria

* User can attach connectors per startup, not only per workspace.
* User can test a connector before saving.
* System shows last successful sync time.
* Failed syncs surface a clear error state.
* User can manually trigger a resync.
* CSV import supports at least:

  * date
  * metric name
  * metric value
  * dimension/startup mapping

---

## Epic 3 — KPI templates and startup models

### Feature

Opinionated KPI packs based on startup type.

### User stories

* As a founder, I want default KPIs instead of building dashboards from scratch.
* As a founder, I want to edit KPI definitions because each startup is slightly different.
* As a founder, I want one north-star metric and a few supporting metrics for each startup.

### Default KPI sets

#### B2B SaaS

* signups
* activated accounts/workspaces
* activation rate
* first key action completed
* WAU / MAU
* trial-to-paid conversion
* MRR
* churn rate

#### Consumer app

* new users/households
* day-1/day-7/day-30 retention
* weekly active users/households
* key action completion rate
* paid conversion
* churn/cancel rate

#### Plugin/widget/app business

* installs
* active installs
* uninstall/prune rate
* auth/connect failures
* usage frequency
* reviews/ratings
* paid conversion if applicable

### Acceptance criteria

* System auto-assigns a default template based on startup type.
* Founder can override north-star metric.
* Founder can disable irrelevant metrics.
* Founder can define at least one custom SQL/API-derived metric per startup in v1, but not a full visual formula builder.
* Each startup must have:

  * 1 north-star metric
  * up to 5 key supporting metrics
  * 1 funnel definition

---

## Epic 4 — Portfolio dashboard

### Feature

One page showing all startups at a glance.

### User stories

* As a founder, I can compare all startups on one screen.
* As a founder, I can instantly spot which startup is healthy, slipping, or critical.
* As a founder, I can drill into a startup from the portfolio view.

### UI blocks

* startup cards
* health score/status
* north-star metric trend
* top alert
* open tasks/experiments count
* last sync state

### Acceptance criteria

* Portfolio view loads all non-archived startups.
* Each startup card shows:

  * name
  * type
  * health status
  * north-star metric with trend vs prior period
  * one key funnel metric
  * top current alert
* User can sort by:

  * health
  * growth
  * churn risk
  * manual priority
* Clicking a startup opens its detail page.

---

## Epic 5 — Startup health page

### Feature

Detailed per-startup view with funnel, retention, revenue, and notable changes.

### User stories

* As a founder, I can inspect why a startup is healthy or unhealthy.
* As a founder, I can view a simple funnel without opening another tool.
* As a founder, I can identify where users drop off.

### Core modules

* KPI summary row
* funnel view
* trend charts
* recent alerts
* AI summary
* task/experiment panel

### Acceptance criteria

* Each startup page shows current period and comparison period.
* Funnel supports at least 3 steps in v1.
* User can define or edit funnel step names and events.
* Trends support day/week/month intervals.
* Retention view can show at least day-1/day-7/day-30 or week cohorts depending on business model.
* Revenue module appears only if billing data is connected.

---

## Epic 6 — Alerts and anomaly detection

### Feature

Surface important changes automatically.

### User stories

* As a founder, I want the system to tell me when something breaks.
* As a founder, I want alerts to be useful, not noisy.
* As a founder, I want alerts tied to specific metrics or funnel steps.

### v1 alert types

* sudden drop in north-star metric
* activation rate decline
* trial-to-paid conversion decline
* churn spike
* uninstall/prune spike
* connector failure / missing data
* no recent growth activity

### Acceptance criteria

* Alerts can be triggered by thresholds and period-over-period deltas.
* Each alert must include:

  * affected startup
  * affected metric
  * comparison period
  * severity
  * timestamp
* Founder can mute an alert type per startup.
* Founder can mark an alert as resolved.
* Duplicate alerts for the same condition within a cooldown window are suppressed.

---

## Epic 7 — AI insight engine

### Feature

AI explains what changed, hypothesizes why, and proposes next steps.

### User stories

* As a founder, I want plain-English explanations instead of raw metric changes.
* As a founder, I want the system to distinguish facts from guesses.
* As a founder, I want recommendations I can execute immediately.

### Insight format

Every insight should contain:

* observation
* likely cause
* impact
* confidence
* recommended actions

### Example

“Activation fell 11% this week. Drop-off increased between signup and first successful workflow. Likely cause: onboarding friction in connector setup. Confidence: medium. Next actions: inspect step-2 errors, add sample workflow, interview 5 failed signups.”

### Acceptance criteria

* AI summaries are generated per startup at least once daily after sync.
* AI must reference actual metrics/events from connected data.
* AI must label statements as either observation or hypothesis.
* Each insight offers 1–3 recommended actions.
* User can thumbs-up/down an insight for feedback.
* User can convert a recommendation into a task.

---

## Epic 8 — Tasks and execution

### Feature

Turn insights into action.

### User stories

* As a founder, I can create tasks from alerts and insights.
* As a founder, I can push tasks into Linear so execution stays in my existing workflow.
* As a founder, I can track whether a task is linked to a startup and metric.

### Acceptance criteria

* User can create an internal task from any alert or AI insight.
* User can send a task to Linear.
* Task includes:

  * title
  * description
  * linked startup
  * linked metric/alert
  * assignee
  * status
* User can mark tasks as open, in progress, done.
* Completed tasks remain linked to the original alert/insight.

---

## Epic 9 — Weekly founder brief

### Feature

A digest summarizing portfolio health and priorities.

### User stories

* As a founder, I want one weekly review instead of checking everything manually.
* As a founder, I want to know the top wins, top problems, and next priorities across startups.

### Acceptance criteria

* System generates one portfolio-level weekly brief.
* System generates one brief per startup.
* Each brief includes:

  * biggest positive change
  * biggest negative change
  * unresolved alerts
  * recommended top 3 priorities
* Brief is viewable in-app in v1.
* Email delivery is optional and may be deferred if scope is tight.

---

## Epic 10 — Lightweight agent activity log

### Feature

Track what internal or external agents did, without building a full agent platform.

### User stories

* As a founder, I want to see what an agent changed or suggested.
* As a founder, I want to connect outputs to a startup and metric.
* As a founder, I need visibility before letting AI do more.

### v1 shape

This should be simple:

* manual or API-created entries
* output type: post draft, analysis, task batch, experiment proposal
* linked startup
* linked objective/metric
* status: proposed, accepted, rejected, done

### Acceptance criteria

* User can log an agent action manually or via API.
* Each entry includes source, startup, summary, linked metric, and status.
* User can filter entries by startup and status.
* Agent log is visible on startup detail page.

---

# v1 user journeys

## Journey 1 — First-time setup

* Founder signs up
* Creates workspace
* Adds 3 startups
* Selects startup types
* Connects Postgres, Stripe, and PostHog for one startup
* Sees first KPI template and startup health page

**Done when:** user reaches meaningful first dashboard in under 20 minutes.

## Journey 2 — Daily review

* Founder opens portfolio page
* Sees one startup in red health state
* Opens startup detail
* Reads AI summary
* Creates task in Linear from recommendation

**Done when:** user can go from issue discovery to assigned task in under 3 minutes.

## Journey 3 — Weekly review

* Founder opens weekly brief
* Compares all startups
* Marks one alert resolved
* Adds one experiment for the weakest startup

**Done when:** founder leaves with top 3 priorities for the week.

---

# v1 data model

Core entities:

* workspace
* startup
* connector
* metric
* metric_value
* funnel
* funnel_step
* alert
* insight
* task
* agent_activity
* weekly_brief

Minimum relationships:

* workspace has many startups
* startup has many connectors, metrics, alerts, tasks, insights
* alerts and insights can link to tasks
* agent activity links to startup and optionally metric/task

---

# Suggested build order

## Slice 1 — Useful without AI polish

* workspace + startups
* Postgres/PostHog/Stripe connectors
* KPI templates
* portfolio dashboard
* startup detail page

## Slice 2 — Make it actionable

* alerts
* AI summaries
* internal tasks
* Linear sync

## Slice 3 — Make it sticky

* weekly founder brief
* agent activity log
* CSV/webhook ingestion
* better tuning for startup types

---

# Definition of done for v1

v1 is ready when a founder with 2+ startups can:

* connect at least one startup end-to-end,
* see portfolio health in one screen,
* detect an activation/retention/revenue issue,
* receive an AI explanation,
* create a task from it,
* return weekly for review.

# Recommended success metrics for v1

* time to first connected startup
* number of connected startups per workspace
* weekly active workspaces
* insights created per week
* task conversion rate from insights
* 4-week retention of users with 2+ startups
