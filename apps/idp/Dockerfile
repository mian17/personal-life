# syntax=docker/dockerfile:1

# Build context is the repo root so the npm workspace (including @life/shared) is available.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/note-service/package.json apps/note-service/
COPY apps/app/package.json apps/app/
COPY apps/idp/package.json apps/idp/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/crypto/package.json packages/crypto/
COPY packages/cache/package.json packages/cache/
COPY apps/tags-service/package.json apps/tags-service/
COPY apps/todo-service/package.json apps/todo-service/
COPY apps/feedback-service/package.json apps/feedback-service/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/idp ./apps/idp

RUN npm run build -w @life/shared \
  && npm run build -w @life/idp \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
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

EXPOSE 3003
CMD ["node", "dist/main.js"]
