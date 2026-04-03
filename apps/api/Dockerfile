FROM oven/bun:1.3.6 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY tsconfig.base.json tsconfig.base.json

FROM oven/bun:1.3.6-slim AS runtime
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/tsconfig.base.json tsconfig.base.json
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/package.json package.json

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "apps/api/src/index.ts"]
