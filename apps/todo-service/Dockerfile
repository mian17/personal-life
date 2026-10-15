# syntax=docker/dockerfile:1

# Build context is the repo root so the npm workspace (@life/shared, @life/crypto,
# @life/cache) is available. Mirrors apps/note-service/Dockerfile.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/note-service/package.json apps/note-service/
COPY apps/app/package.json apps/app/
COPY apps/idp/package.json apps/idp/
COPY apps/tags-service/package.json apps/tags-service/
COPY apps/todo-service/package.json apps/todo-service/
COPY apps/feedback-service/package.json apps/feedback-service/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/crypto/package.json packages/crypto/
COPY packages/cache/package.json packages/cache/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/crypto ./packages/crypto
COPY packages/cache ./packages/cache
COPY apps/todo-service ./apps/todo-service

RUN npm run build -w @life/shared \
  && npm run build -w @life/crypto \
  && npm run build -w @life/cache \
  && npm run build -w @life/todo-service \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3005 \
    HOST=0.0.0.0 \
    DB_PATH=/data/todo.db
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/crypto/package.json ./packages/crypto/package.json
COPY --from=build /repo/packages/crypto/dist ./packages/crypto/dist
COPY --from=build /repo/packages/cache/package.json ./packages/cache/package.json
COPY --from=build /repo/packages/cache/dist ./packages/cache/dist
COPY --from=build /repo/apps/todo-service/package.json ./package.json
COPY --from=build /repo/apps/todo-service/dist ./dist

EXPOSE 3005
CMD ["node", "dist/main.js"]
