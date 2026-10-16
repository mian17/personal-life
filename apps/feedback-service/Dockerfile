# syntax=docker/dockerfile:1

# Build context is the repo root so the npm workspace (@life/shared, @life/crypto,
# @life/cache) is available. Mirrors apps/tags-service/Dockerfile, minus the
# SQLite packages (feedback-service is Postgres-only).
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
COPY packages/crypto ./packages/crypto
COPY packages/cache ./packages/cache
COPY apps/feedback-service ./apps/feedback-service

RUN npm run build -w @life/shared \
  && npm run build -w @life/crypto \
  && npm run build -w @life/cache \
  && npm run build -w @life/feedback-service \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3008 \
    HOST=0.0.0.0
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/crypto/package.json ./packages/crypto/package.json
COPY --from=build /repo/packages/crypto/dist ./packages/crypto/dist
COPY --from=build /repo/packages/cache/package.json ./packages/cache/package.json
COPY --from=build /repo/packages/cache/dist ./packages/cache/dist
COPY --from=build /repo/apps/feedback-service/package.json ./package.json
COPY --from=build /repo/apps/feedback-service/dist ./dist

EXPOSE 3008
CMD ["node", "dist/main.js"]
