# syntax=docker/dockerfile:1

# Build context is the repo root so the npm workspace (including @life/shared) is available.
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
COPY apps/idp ./apps/idp

RUN npm run build -w @life/shared \
  && npm run build -w @life/idp \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3003 \
    HOST=0.0.0.0 \
    DB_PATH=/data/idp.db
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/idp/package.json ./package.json
COPY --from=build /repo/apps/idp/dist ./dist

USER node
EXPOSE 3003
CMD ["node", "dist/main.js"]
