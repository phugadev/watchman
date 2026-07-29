# syntax=docker/dockerfile:1
#
# Watchman ships as a single self-contained image. No Postgres, no Redis, no
# sidecar worker: the scheduler runs in-process and state lives in one SQLite
# file on a mounted volume.

# ---- deps -------------------------------------------------------------------
# better-sqlite3 is a native addon, so the builder needs a toolchain. It is
# compiled here and copied forward, keeping build tools out of the final image.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat tini
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    WATCHMAN_DB_PATH=/data/watchman.db

RUN addgroup -g 1001 -S watchman && adduser -u 1001 -S watchman -G watchman

COPY --from=build --chown=watchman:watchman /app/.next/standalone ./
COPY --from=build --chown=watchman:watchman /app/.next/static ./.next/static
COPY --from=build --chown=watchman:watchman /app/public ./public
# Drizzle migrations are applied on boot, so they must be present at runtime.
COPY --from=build --chown=watchman:watchman /app/drizzle ./drizzle
# Next's file tracing cannot follow better-sqlite3's runtime binding lookup;
# copy the compiled addon in explicitly.
COPY --from=build --chown=watchman:watchman /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=build --chown=watchman:watchman /app/node_modules/bindings ./node_modules/bindings
COPY --from=build --chown=watchman:watchman /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

RUN mkdir -p /data && chown -R watchman:watchman /data
VOLUME /data
USER watchman
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
