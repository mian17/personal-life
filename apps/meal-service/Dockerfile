# syntax=docker/dockerfile:1

# Build context is the repo root so the npm workspace (@life/shared, @life/crypto,
# @life/cache, @life/db, @life/nutrition) is available. Mirrors
# apps/note-service/Dockerfile.
FROM node:24-bookworm-slim AS build
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
COPY packages/db ./packages/db
COPY packages/nutrition ./packages/nutrition
COPY packages/service-kit ./packages/service-kit
COPY apps/meal-service ./apps/meal-service

RUN npm run build -w @life/shared \
  && npm run build -w @life/db \
  && npm run build -w @life/crypto \
  && npm run build -w @life/cache \
  && npm run build -w @life/nutrition \
 && npm run build -w @life/service-kit \
  && npm run build -w @life/meal-service \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3106 \
    HOST=0.0.0.0 \
    DB_PATH=/data/meal.db
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/crypto/package.json ./packages/crypto/package.json
COPY --from=build /repo/packages/crypto/dist ./packages/crypto/dist
COPY --from=build /repo/packages/cache/package.json ./packages/cache/package.json
COPY --from=build /repo/packages/cache/dist ./packages/cache/dist
COPY --from=build /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/nutrition/package.json ./packages/nutrition/package.json
COPY --from=build /repo/packages/nutrition/dist ./packages/nutrition/dist
COPY --from=build /repo/packages/service-kit/package.json ./packages/service-kit/package.json
COPY --from=build /repo/packages/service-kit/dist ./packages/service-kit/dist
COPY --from=build /repo/apps/meal-service/package.json ./package.json
COPY --from=build /repo/apps/meal-service/dist ./dist

USER node
EXPOSE 3106
CMD ["node", "dist/main.js"]