# =============================================================================
# Porta — Multi-stage production Dockerfile
# Targets: api, web, worker
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 0: base — shared Bun image with workspace install
# ---------------------------------------------------------------------------
FROM oven/bun:1.3 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/shared packages/shared
COPY tsconfig.base.json tsconfig.base.json

# ---------------------------------------------------------------------------
# Target: api — Bun production runtime
# ---------------------------------------------------------------------------
FROM base AS api-build
COPY apps/api apps/api

FROM oven/bun:1.3-slim AS api
WORKDIR /app
COPY --from=api-build /app/node_modules node_modules
COPY --from=api-build /app/packages/shared packages/shared
COPY --from=api-build /app/tsconfig.base.json tsconfig.base.json
COPY --from=api-build /app/apps/api apps/api
COPY --from=api-build /app/package.json package.json

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "apps/api/src/index.ts"]

# ---------------------------------------------------------------------------
# Target: web — Vite build then nginx static serving with /api proxy
# ---------------------------------------------------------------------------
FROM base AS web-build
COPY apps/web apps/web
RUN cd apps/web && bun run build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# ---------------------------------------------------------------------------
# Target: worker — Bun build, Node runtime
# ---------------------------------------------------------------------------
FROM base AS worker-build
COPY apps/worker apps/worker
RUN cd apps/worker && bun run build

FROM node:22-slim AS worker
WORKDIR /app
COPY --from=worker-build /app/apps/worker/dist dist
COPY --from=worker-build /app/apps/worker/package.json package.json

# Install only production dependencies needed by the bundled worker.
# The bun build output is a self-contained bundle, but native modules
# (pg, ioredis, bullmq) still need their Node addons.
COPY --from=worker-build /app/node_modules node_modules

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
