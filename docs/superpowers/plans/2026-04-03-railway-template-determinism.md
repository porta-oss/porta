# Railway Template Determinism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Railway template deterministic by replacing builder auto-detection with explicit per-service Dockerfiles and hardened config-in-code.

**Architecture:** Keep the existing monorepo and app runtime model, but give Railway three explicit build contracts: one Dockerfile each for API, Web, and Worker. Pair each with service-local `railway.toml` files that declare the Dockerfile path, rebuild scope, health behavior, and restart behavior. Update docs so the checked-in config is the source of truth.

**Tech Stack:** Railway config-as-code, Docker, Bun, nginx, Node, TypeScript

---

## File Map

- Create: `docs/superpowers/specs/2026-04-03-railway-template-determinism-design.md`
- Create: `docs/superpowers/plans/2026-04-03-railway-template-determinism.md`
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Modify: `apps/api/railway.toml`
- Modify: `apps/web/railway.toml`
- Modify: `apps/worker/railway.toml`
- Modify: `docs/self-hosting.md`

### Task 1: Add Explicit Service Dockerfiles

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`

- [ ] **Step 1: Build a focused API image contract**

Create `apps/api/Dockerfile` as a monorepo-aware Bun runtime image that installs from the workspace root, copies `packages/shared` plus `apps/api`, and starts with:

```dockerfile
CMD ["bun", "apps/api/src/index.ts"]
```

- [ ] **Step 2: Build a focused Web image contract**

Create `apps/web/Dockerfile` as a multistage build that compiles `apps/web` with Bun and serves `apps/web/dist` through nginx using the checked-in `apps/web/nginx.conf`.

- [ ] **Step 3: Build a focused Worker image contract**

Create `apps/worker/Dockerfile` as a multistage build that compiles `apps/worker/src/index.ts` to `dist/` and runs:

```dockerfile
CMD ["node", "dist/index.js"]
```

- [ ] **Step 4: Verify the three Dockerfiles build**

Run:

```bash
docker build -f apps/api/Dockerfile .
docker build -f apps/web/Dockerfile .
docker build -f apps/worker/Dockerfile .
```

Expected: all three images build successfully from the repo root context.

### Task 2: Harden Railway Config-In-Code

**Files:**
- Modify: `apps/api/railway.toml`
- Modify: `apps/web/railway.toml`
- Modify: `apps/worker/railway.toml`

- [ ] **Step 1: Switch each service to Dockerfile builds**

Replace the current Nixpacks builder declarations with:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "apps/<service>/Dockerfile"
watchPatterns = ["apps/<service>/**", "packages/shared/**", "package.json", "bun.lock", "tsconfig.base.json"]
```

- [ ] **Step 2: Keep service-specific deploy behavior explicit**

Retain API `healthcheckPath` and restart policy, keep Web restart policy explicit, and keep Worker as a background service with restart policy only.

- [ ] **Step 3: Verify config parses cleanly by building through the Dockerfiles**

Run the Docker build commands again after the TOML changes. Expected: no drift between config-in-code assumptions and the Dockerfile paths.

### Task 3: Update Railway Documentation

**Files:**
- Modify: `docs/self-hosting.md`

- [ ] **Step 1: Rewrite the Railway deployment section to match the new contract**

Describe Railway as deploying from service-local Dockerfiles referenced by the app-local `railway.toml` files.

- [ ] **Step 2: Tighten the service table**

Document the service directory, Dockerfile, and expected runtime behavior for API, Web, and Worker.

- [ ] **Step 3: Preserve environment guidance**

Keep the current env var reference, but update wording that currently assumes Nixpacks root-directory behavior.

### Task 4: Validate The Final State

**Files:**
- Modify: `apps/api/railway.toml`
- Modify: `apps/web/railway.toml`
- Modify: `apps/worker/railway.toml`
- Modify: `docs/self-hosting.md`
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`

- [ ] **Step 1: Run repo checks relevant to touched files**

Run:

```bash
pnpm dlx ultracite check apps/api/railway.toml apps/web/railway.toml apps/worker/railway.toml docs/self-hosting.md
```

Expected: formatting and linting pass for the touched config and docs.

- [ ] **Step 2: Summarize template readiness**

Confirm the repo now has explicit Railway build contracts for all three services and is ready for Railway template publication/testing.
