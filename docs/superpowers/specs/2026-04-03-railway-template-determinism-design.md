# Railway Template Determinism Design

## Goal

Make the `porta-oss/porta` Railway template deterministic for first-time deploys by removing ambiguous monorepo build detection and making each Railway service own an explicit build/runtime contract.

## Scope

This design only covers Railway deployment hardening for the existing `api`, `web`, and `worker` services plus related documentation. It does not change application features, runtime APIs, or the Docker Compose deployment path.

## Current Problems

- The current Railway setup relies on Nixpacks auto-detection from per-service `railway.toml` files inside a monorepo.
- The Web service starts through `npx serve ...`, which can introduce runtime drift and unnecessary network dependency.
- The repo also contains a root multi-target `Dockerfile`, which is useful for self-hosting but can become a template footgun if Railway service wiring is misconfigured.
- The docs assume the right service root/config mapping but do not make the deterministic path explicit enough.

## Chosen Approach

Use one Dockerfile per Railway service:

- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `apps/worker/Dockerfile`

Each service keeps a colocated `railway.toml` that points at its Dockerfile with explicit config-in-code.

This is preferred over continuing with Nixpacks because Railway template consumers should get the same build graph every time, independent of builder heuristics or dashboard drift.

## Service Design

### API

- Build from the monorepo root context so workspace dependencies resolve consistently.
- Install dependencies once with Bun.
- Copy only the API and shared package sources needed for runtime.
- Start with `bun apps/api/src/index.ts`.
- Keep the `/api/health` health check in config-in-code.

### Web

- Build the SPA with Bun from the monorepo root context.
- Serve the built assets with nginx baked into the image.
- Reuse the checked-in nginx SPA/static config.
- Avoid runtime `npx serve`.

### Worker

- Build the worker bundle with Bun.
- Run the built worker with Node in production, preserving the existing native-module compatibility model.
- Keep the worker private with no public health endpoint requirement.

## Railway Config

Each service `railway.toml` should:

- use `builder = "DOCKERFILE"`
- set `dockerfilePath` explicitly
- set `watchPatterns` to only rebuild when relevant monorepo files change
- keep restart policy in config-in-code
- keep API healthcheck in config-in-code

## Documentation Changes

- Update `docs/self-hosting.md` to describe the deterministic Dockerfile-based Railway path.
- Clarify that service config is colocated with each app and that Dockerfiles are the canonical deploy contract.
- Keep the current environment variable guidance, but tighten wording around service wiring and first deployment expectations.

## Verification

Minimum verification for this change:

- Build `apps/api/Dockerfile`
- Build `apps/web/Dockerfile`
- Build `apps/worker/Dockerfile`
- Run workspace lint on touched config/docs files

## Non-Goals

- Publishing the Railway template itself from the dashboard/API
- Adding a reverse proxy or collapsing Web/API onto one public service
- Reworking the root self-hosting `Dockerfile`
