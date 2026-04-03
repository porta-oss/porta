# Self-Hosting Porta

Porta is a three-service application — **API**, **Web**, and **Worker** — backed by **Postgres** and **Redis**. This guide covers two deployment paths: Docker Compose (recommended for most self-hosters) and Railway.

---

## Prerequisites

| Dependency | Minimum version |
|------------|----------------|
| Docker + Docker Compose | 24.x / Compose V2 |
| PostgreSQL | 16 |
| Redis | 7 |
| Bun (Railway/source builds) | 1.3 |

---

## Path 1: Docker Compose

The checked-in `docker-compose.yml` runs all five services (Postgres, Redis, API, Web, Worker) with a single command. This is the fastest way to get Porta running.

### 1. Clone and configure

```bash
git clone https://github.com/nicholasgriffintn/porta.git
cd porta
cp .env.example .env
```

### 2. Set required secrets

Open `.env` and replace the placeholder values for the two required secrets:

```bash
# Must be at least 32 characters — used for session signing
BETTER_AUTH_SECRET=replace-with-a-local-secret-at-least-32-characters-long

# Must be exactly 64 hex characters (32 bytes) — used for AES-256-GCM credential encryption
CONNECTOR_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

> **Tip:** Generate a secure secret with `openssl rand -hex 32`.

### 3. Start the stack

```bash
docker compose up --build
```

Docker Compose will:

- Start Postgres and Redis first (health-checked).
- Build and start the API on port **3000**.
- Build and start the Web UI on port **80**.
- Start the Worker after the API is healthy.

### 4. Verify

```bash
# API health
curl http://localhost:3000/api/health
# → { "status": "ok", "release": { "product": "porta", "maturity": "alpha", ... } }

# Web UI
open http://localhost
```

### 5. Stop

```bash
docker compose down          # stop services
docker compose down -v       # stop and delete volumes (destroys data)
```

---

## Path 2: Railway

Railway deploys each service from the monorepo using the `railway.toml` files checked into `apps/api/`, `apps/web/`, and `apps/worker/`. Each service now uses an explicit Dockerfile, so the build/runtime contract lives in the repo instead of depending on builder auto-detection.

### 1. Create a Railway project

1. Go to [railway.app](https://railway.app) and create a new project.
2. Add a **PostgreSQL** service (Railway plugin).
3. Add a **Redis** service (Railway plugin).

### 2. Add the three application services

Create three services from the same GitHub repo:

| Service | Config file | Dockerfile | Runtime |
|---------|-------------|------------|---------|
| API     | `apps/api/railway.toml` | `apps/api/Dockerfile` | Bun API server with `/api/health` |
| Web     | `apps/web/railway.toml` | `apps/web/Dockerfile` | nginx serving the built SPA |
| Worker  | `apps/worker/railway.toml` | `apps/worker/Dockerfile` | Node worker process |

> Railway reads the `railway.toml` in each service directory for build/deploy config. The checked-in config points at the service Dockerfile and scoped watch paths, which makes template deploys more predictable for shared-monorepo builds.

### 3. Set environment variables

For each service, set the required env vars (see [Environment Reference](#environment-reference) below). Railway provides `DATABASE_URL` and `REDIS_URL` automatically when you reference the Postgres and Redis plugins.

Key Railway-specific notes:

- Set `BETTER_AUTH_SECRET` and `CONNECTOR_ENCRYPTION_KEY` as shared variables across all services.
- Set `API_URL` on the Web service to the Railway-generated API URL (e.g., `https://porta-api-production.up.railway.app`). The Web container writes this into `/env.js` at startup, so you do not need a rebuild when the API domain changes.
- Set `WEB_URL` on the Web service to the Railway-generated Web URL if you want an explicit frontend origin in runtime config. If omitted, the browser origin is used.
- Set `WEB_URL` on the API service to the Railway-generated Web URL.
- Set `BETTER_AUTH_URL` on the API to the same value as `API_URL`.
- Do not set `PORT` manually. Railway injects it automatically, and the checked-in Dockerfiles/config are wired to use it.

### 4. Deploy

Push to your connected branch. Railway will build and deploy all three services from their checked-in Dockerfiles. The API service has a health check configured at `/api/health`, and the Web service has a health check configured at `/`.

---

## Environment Reference

All variables are defined in `.env.example` at the repo root.

### Required — Core

These must be set for Porta to start. Missing any of these causes a fail-fast startup error.

| Variable | Description | Example |
|----------|-------------|---------|
| `BETTER_AUTH_SECRET` | Session signing secret (≥32 chars) | `openssl rand -hex 32` |
| `CONNECTOR_ENCRYPTION_KEY` | AES-256-GCM key for credential storage (64 hex chars) | `openssl rand -hex 32` |
| `DATABASE_URL` | Postgres connection string | `postgres://postgres:postgres@localhost:5432/porta` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `API_URL` | Public URL of the API service | `http://localhost:3000` |
| `WEB_URL` | Public URL of the Web UI | `http://localhost:5173` |
| `BETTER_AUTH_URL` | Auth callback base URL (usually same as `API_URL`) | `http://localhost:3000` |

### Required — Service config

These have sensible defaults in `.env.example` and `docker-compose.yml` but should be reviewed.

| Variable | Default | Description |
|----------|---------|-------------|
| `API_HOST` | `0.0.0.0` | API bind address |
| `API_PORT` | `3000` | API listen port |
| `NODE_ENV` | `development` | Runtime environment |
| `PORTA_EDITION` | `community` | Edition identifier |
| `MAGIC_LINK_SENDER_EMAIL` | `dev@porta.local` | From address for magic link emails |
| `AUTH_CONTEXT_TIMEOUT_MS` | `2000` | Auth context resolution timeout |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000` | Database connection timeout |
| `DATABASE_POOL_MAX` | `10` | Max database pool connections |
| `WORKER_CONCURRENCY` | `3` | Worker parallel job count |
| `JOB_TIMEOUT_MS` | `30000` | Max duration per worker job |

### Optional — Google OAuth

Leave unset to disable Google sign-in. Porta falls back to magic-link authentication.

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |

### Optional — Anthropic (AI Insights)

Leave unset to disable AI-powered insight generation.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (starts with `sk-ant-`) |

### Optional — Linear (Issue Sync)

Leave unset to disable Linear integration in the worker.

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | Linear API key (starts with `lin_api_`) |
| `LINEAR_TEAM_ID` | Linear team UUID for issue sync |

### Optional — Development / Testing

| Variable | Description |
|----------|-------------|
| `FOUNDER_PROOF_MODE` | Enable deterministic connector validation (`true` / `false`) |

---

## Troubleshooting

### Missing `BETTER_AUTH_SECRET`

**Symptom:** API crashes on startup with `BETTER_AUTH_SECRET is required`.

**Fix:** Set `BETTER_AUTH_SECRET` in your `.env` file or Railway service variables. Generate one with:

```bash
openssl rand -hex 32
```

### Invalid `CONNECTOR_ENCRYPTION_KEY`

**Symptom:** API or Worker fails to encrypt/decrypt connector credentials. Error mentions AES-256-GCM or key length.

**Fix:** The key must be exactly 64 hexadecimal characters (32 bytes). Generate one with:

```bash
openssl rand -hex 32
```

### Bad `API_URL` or `WEB_URL`

**Symptom:** OAuth callbacks fail, CORS errors in the browser, or the web app cannot reach the API.

**Fix:** Ensure `API_URL` points to the externally reachable API address (not `localhost` in production). On Railway, use the generated service URL. In Docker Compose, the defaults (`http://localhost:3000` / `http://localhost`) are correct for local access.

### Unhealthy API service

**Symptom:** Docker Compose shows `porta-api` as unhealthy, or Railway health check fails.

**Fix:**

1. Check API logs: `docker compose logs api`
2. Verify Postgres is reachable: `docker compose exec api wget -qO- http://localhost:3000/api/health`
3. Confirm `DATABASE_URL` and `REDIS_URL` resolve to running services.
4. In Docker Compose, Postgres and Redis must be healthy before the API starts — check their container status.

### Worker not processing jobs

**Symptom:** Jobs are queued but not processed.

**Fix:**

1. Check worker logs: `docker compose logs worker`
2. Verify `REDIS_URL` is correct and Redis is running.
3. Confirm `CONNECTOR_ENCRYPTION_KEY` matches between API and Worker — mismatched keys cause silent decryption failures.

### Railway deploys the wrong process

**Symptom:** The API service runs the worker, or vice versa.

**Fix:** Each Railway service must have the correct root directory and use the `railway.toml` from its respective `apps/` subdirectory. Verify the start command in Railway's service settings matches the `[deploy].startCommand` in the corresponding `railway.toml`.

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│   Web (SPA)  │────▶│   API (Bun)  │────▶│  Worker (Node) │
│   port 80    │     │   port 3000  │     │   background   │
└─────────────┘     └──────┬───────┘     └───────┬────────┘
                           │                     │
                    ┌──────┴──────┐        ┌─────┴─────┐
                    │  PostgreSQL  │        │   Redis    │
                    │  port 5432   │        │  port 6379 │
                    └─────────────┘        └───────────┘
```

- **Web** serves the React SPA via nginx (Docker) or a static server (Railway). Proxies `/api` requests to the API service.
- **API** runs the Elysia server on Bun. Handles auth, CRUD, and job enqueueing.
- **Worker** processes background jobs (connector sync, Linear sync, AI insights) via BullMQ.
- **PostgreSQL** stores all application data.
- **Redis** backs BullMQ job queues and optional caching.

For the compose service graph and healthcheck configuration, see [`docker-compose.yml`](../docker-compose.yml).
