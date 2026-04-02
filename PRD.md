## PRD — Porta

**Working title**
Porta

**Product vision**
A multi-startup operating system for founders, indie hackers, and small teams that connects product, growth, revenue, and execution data into one place, then uses AI to explain what matters, why it matters, and what to do next.

**Problem**
Founders running multiple startups live inside fragmented tools: analytics, CRM, billing, support, social, databases, task managers, and spreadsheets. They can build dashboards in Grafana, Metabase, or admin panels, but rebuilding the same reporting and operational layer for every startup is repetitive and expensive. The harder problem is not collecting metrics — it is understanding where each startup is stuck and converting signals into action. As a result, founders lose time, miss issues, react too late to churn or onboarding problems, and struggle to coordinate humans and AI agents across products.

**Target user**
Solo founders, startup studios, and micro-teams running 2–10 products in parallel. Primary examples:

* B2B SaaS / AI tools like Triggo
* Consumer/family apps like Heymily
* App/plugin businesses like a CRM widgets factory for amoCRM/Shopify

**Core job-to-be-done**
“Show me which startup needs attention today, what is broken or growing, and give me the next best actions without making me inspect five different tools.”

**Goals for MVP**

* Give founders one cross-startup overview
* Surface the most important KPIs per startup automatically
* Detect issues in activation, retention, conversion, churn, and outreach
* Turn insights into concrete actions: tasks, experiments, and content/outreach drafts
* Support lightweight oversight of agent-generated work

**Non-goals for MVP**

* Full BI/dashboard builder
* Full CRM replacement
* Full social media scheduler
* Full project management replacement
* Autonomous posting or autonomous decision-making without review

**MVP scope**
The product has three layers.

**1) Portfolio overview**
A home view with one card per startup showing:

* current stage
* north-star metric
* key funnel metric
* growth trend
* churn/retention health
* urgent alerts
* open tasks / experiments

**2) Startup intelligence**
Each startup gets a model-specific health dashboard:

* **Widget/app business:** installs, active installs, uninstall rate, auth/connect errors, reviews, support volume
* **B2B SaaS / AI IPaaS:** signups, activated workspaces, first successful workflow, WAU/MAU, PQLs, churn risk
* **Consumer app:** households onboarded, week-1/week-4 retention, completed nudges/tasks, habit formation signals

**3) AI copilot + execution**
AI should:

* summarize what changed
* identify likely root causes
* explain impact
* recommend next actions
* create tasks in Linear or internal tasks
* draft experiments, outreach ideas, or revised messaging
* critique weak launch/outreach posts and suggest better variants

**Primary user flow**

1. User signs up and creates a workspace
2. User adds startups/orgs
3. Product asks for connections: Postgres, Stripe, analytics, CRM, Shopify, support, social, task tools
4. System maps startup type and suggests KPI template
5. Dashboard appears with baseline metrics and alerts
6. AI generates a daily/weekly founder brief
7. User accepts recommended actions, creates tasks, or assigns work to agents/humans

**Functional requirements**

* Workspace with multiple startups under one account
* Connector framework for Postgres, Stripe, PostHog/Mixpanel/Amplitude, HubSpot/Pipedrive, Shopify, CSV/manual import, webhooks
* Configurable KPI templates by business model
* Alert engine for anomalies and threshold drops
* AI insight layer with plain-language explanations and confidence labels
* Task creation to Linear and/or internal task board
* Lightweight “agent activity log” showing output, owner, linked metric, and status
* Weekly summary per startup and cross-portfolio summary

**AI behavior requirements**

* Never just restate metrics; always explain likely meaning
* Separate observed facts from hypotheses
* Prioritize impact and urgency
* Recommend no more than 3 next actions at a time
* Keep a founder tone: direct, pragmatic, and non-generic
* Flag poor outreach or onboarding with evidence, not fluff

**Example output**

* “Triggo activation dropped 12% week-over-week. Most users fail before first successful workflow. Likely cause: connector setup friction introduced in the latest onboarding flow. Recommended actions: inspect step-2 drop-off, add guided sample workflow, interview 5 failed signups.”
* “Heymily retention is weak after week 1, but families who complete 3 nudges in the first 48 hours retain significantly better. Recommend redesigning onboarding around first completed routine.”
* “Your latest r/saas post underperformed. Hook is too generic, no proof, and weak CTA. Here are 3 revised versions tailored for founders, operators, and indie hackers.”

**Success metrics**

* Time to first integrated dashboard under 20 minutes
* Weekly active founders reviewing at least one startup brief
* At least 30% of AI insights converted into tasks or experiments
* Reduction in manual reporting time by 50%+
* Retention of users managing 2+ startups
* NPS/qualitative signal: “I know what to do next”

**Biggest risks**

* Becoming a generic dashboard product with weak differentiation
* Connector complexity across many stacks
* Low trust in AI recommendations if insights are vague or wrong
* Scope creep into CRM/social/project management

**Launch thesis**
Position as a **founder decision engine**, not another dashboard tool:
**“Run all your startups from one AI operating review.”**
