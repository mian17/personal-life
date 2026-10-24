# syntax=docker/dockerfile:1

# Build context is the repo root so the npm workspace (including @life/shared) is available.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# --- shared dependency layer (SPEC-compose-build) ------------------------------
# The same instructions in all seven apps/*/Dockerfile files. Do not edit one
# without editing all seven: a different block is a different layer key, which
# un-dedupes `npm ci` and costs ~30 minutes of build. `scripts/preflight-build.sh`
# asserts the seven blocks match.
COPY package.json package-lock.json ./
COPY --parents apps/*/package.json packages/*/package.json ./

RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/nutrition ./packages/nutrition
COPY packages/ui ./packages/ui
COPY packages/app-kit ./packages/app-kit
COPY apps/pomodoro ./apps/pomodoro
COPY apps/app ./apps/app

RUN npm run build -w @life/shared \
  && npm run build -w @life/nutrition \
  && npm run build -w @life/app

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3002 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# `output: 'standalone'` with the repo root as the tracing root produces
# /repo/apps/app/.next/standalone/apps/app/server.js plus a minimal node_modules.
COPY --from=build /repo/apps/app/.next/standalone ./
COPY --from=build /repo/apps/app/.next/static ./apps/app/.next/static
COPY --from=build /repo/apps/app/public ./apps/app/public

# Ensure @life/shared is resolvable at runtime even though it is also transpiled
# into the bundle, so the standalone server can always require it.
COPY --from=build /repo/packages/shared/package.json ./node_modules/@life/shared/package.json
COPY --from=build /repo/packages/shared/dist ./node_modules/@life/shared/dist
# Same safety net for @life/nutrition (built artifact, transpiled into the bundle).
COPY --from=build /repo/packages/nutrition/package.json ./node_modules/@life/nutrition/package.json
COPY --from=build /repo/packages/nutrition/dist ./node_modules/@life/nutrition/dist
# Same safety net for @life/ui (source-shipped and transpiled into the bundle).
COPY --from=build /repo/packages/ui/package.json ./node_modules/@life/ui/package.json
COPY --from=build /repo/packages/ui/src ./node_modules/@life/ui/src
# Same safety net for @life/app-kit (source-shipped and transpiled into the bundle).
COPY --from=build /repo/packages/app-kit/package.json ./node_modules/@life/app-kit/package.json
COPY --from=build /repo/packages/app-kit/src ./node_modules/@life/app-kit/src
# Same safety net for @life/pomodoro (source-shipped and transpiled into the bundle).
COPY --from=build /repo/apps/pomodoro/package.json ./node_modules/@life/pomodoro/package.json
COPY --from=build /repo/apps/pomodoro/src ./node_modules/@life/pomodoro/src

# Next writes image/fetch caches under .next/cache at runtime; only that
# directory is node-owned — application code stays root-owned and immutable.
RUN mkdir -p /app/apps/app/.next/cache \
 && chown -R node:node /app/apps/app/.next/cache
USER node
EXPOSE 3002
CMD ["node", "apps/app/server.js"]
