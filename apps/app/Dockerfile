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
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/app ./apps/app

RUN npm run build -w @life/shared \
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

EXPOSE 3002
CMD ["node", "apps/app/server.js"]
