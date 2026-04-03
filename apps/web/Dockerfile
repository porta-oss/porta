FROM oven/bun:1.3.6 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/shared packages/shared
COPY apps/web apps/web
COPY tsconfig.base.json tsconfig.base.json

RUN cd apps/web && bun run build

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY --from=build /app/apps/web/public/env.js /usr/share/nginx/html/env.js
COPY apps/web/nginx.railway.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/docker-entrypoint.d/40-write-runtime-env.sh /docker-entrypoint.d/40-write-runtime-env.sh

EXPOSE 8080
