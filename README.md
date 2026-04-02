<p align="center">
  <strong>Porta</strong><br />
  Portfolio intelligence for multi-startup founders
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="docs/self-hosting.md">Self-Host Guide</a> ·
  <a href="FEATURES.md">Feature Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

> **Alpha software.** Porta is under active development.
> APIs, database schemas, and configuration may change between releases.
> There is no managed offering — community self-hosting only.
> See [SECURITY.md](SECURITY.md) for disclosure policy.

---

## What is Porta?

Porta is a self-hosted dashboard for founders running multiple startups. It connects your data sources (Stripe, PostHog, Postgres), computes startup health from real metrics, generates AI-powered insights, and turns those insights into actionable tasks — answering one question:

**"Which startup needs attention today, and what should I do next?"**

### Key capabilities

- **Portfolio view** — all your startups, ranked by health, at a glance
- **Connector pipeline** — pull metrics from Stripe, PostHog, Postgres, and custom sources
- **Startup health** — computed health scores with funnel-stage breakdowns
- **AI insights** — Anthropic-powered analysis that explains what changed and why
- **Task creation** — turn insight actions into tracked tasks, optionally synced to Linear
- **Weekly founder brief** — scheduled digest of portfolio health (planned)

## Architecture

Porta is a monorepo with three runtime services and a shared package:

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Web App   │   │   API       │   │   Worker     │
│  React/Vite │──▶│  Elysia/Bun │◀──│  BullMQ/Bun  │
│  :5173      │   │  :3000      │   │  (background) │
└─────────────┘   └──────┬──────┘   └──────┬──────┘
                         │                 │
                   ┌─────┴─────┐     ┌─────┴─────┐
                   │ Postgres  │     │   Redis    │
                   │  (data)   │     │  (queues)  │
                   └───────────┘     └───────────┘
```

| Service | Stack | Purpose |
|---------|-------|---------|
| **API** (`apps/api`) | Elysia · Bun · Drizzle · Better Auth | REST API, auth, health endpoints |
| **Web** (`apps/web`) | React 19 · Vite · TanStack Router | SPA dashboard |
| **Worker** (`apps/worker`) | BullMQ · Bun | Connector sync, health snapshots, AI insights |
| **Shared** (`packages/shared`) | TypeScript | Contracts, types, validation schemas |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://docs.docker.com/get-docker/) (for Postgres + Redis)
- [pnpm](https://pnpm.io) ≥ 9

### Local development

```bash
# Clone and install
git clone https://github.com/nicbelyaev/porta.git
cd porta
pnpm install

# Start Postgres + Redis
pnpm services:up

# Copy environment and configure
cp .env.example .env
# Edit .env — set BETTER_AUTH_SECRET and CONNECTOR_ENCRYPTION_KEY at minimum

# Run database migrations
bun run --cwd apps/api src/db/migrate.ts

# Start API + Web
pnpm dev

# In a separate terminal, start the worker
pnpm dev:worker
```

The web app is at `http://localhost:5173`, the API at `http://localhost:3000`.

### Docker Compose (full stack)

```bash
cp .env.example .env
# Edit .env with your secrets
docker compose up --build
```

See [docs/self-hosting.md](docs/self-hosting.md) for the full self-hosting guide, including Railway deployment and environment variable reference.

## Deploy on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/porta)

> **Note:** The Railway template provisions Postgres and Redis automatically.
> You will need to set `BETTER_AUTH_SECRET`, `CONNECTOR_ENCRYPTION_KEY`, and your OAuth credentials after deployment.
> See [docs/self-hosting.md](docs/self-hosting.md) for configuration details.

## Alpha Status

Porta is in **alpha**. This means:

- **No managed service** — self-host only, community support via [GitHub Discussions](https://github.com/nicbelyaev/porta/discussions)
- **Breaking changes** — database migrations may not be reversible between versions
- **No SLA** — uptime, data durability, and API stability are not guaranteed
- **Security** — report vulnerabilities privately via [GitHub Security Advisories](https://github.com/nicbelyaev/porta/security/advisories/new) (see [SECURITY.md](SECURITY.md))

The `/api/health` endpoint exposes runtime metadata including `release.maturity: "alpha"` for programmatic maturity checks.

## Project Structure

```
porta/
├── apps/
│   ├── api/          # Elysia API server
│   ├── web/          # React SPA dashboard
│   └── worker/       # BullMQ background worker
├── packages/
│   └── shared/       # Shared types, contracts, validation
├── docs/             # Self-hosting guide, architecture notes
├── docker-compose.yml
├── FEATURES.md       # Feature roadmap
├── CONTRIBUTING.md   # Contribution guide
├── CODE_OF_CONDUCT.md
├── SECURITY.md       # Security disclosure policy
└── LICENSE           # AGPL-3.0
```

## License

Porta is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

**Trademark:** "Porta" is a trademark of its maintainers. You may fork and modify the software under AGPL-3.0, but you may not use the "Porta" name or branding for derivative products without permission.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

## Community

- [GitHub Discussions](https://github.com/nicbelyaev/porta/discussions) — questions, ideas, show & tell
- [GitHub Issues](https://github.com/nicbelyaev/porta/issues) — bug reports and feature requests (use templates)
- [Security Advisories](https://github.com/nicbelyaev/porta/security/advisories/new) — private vulnerability reports
