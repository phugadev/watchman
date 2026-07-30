# syntax=docker/dockerfile:1
#
# Watchman ships as a single self-contained image. No Postgres, no Redis, no
# sidecar worker: the scheduler runs in-process and state lives in one SQLite
# file on a mounted volume.

# ---- deps -------------------------------------------------------------------
# better-sqlite3 ships prebuilt addons for linuxmusl, so this normally needs no
# toolchain — but the toolchain stays as a fallback in case a future version or
# architecture has no matching prebuild. It costs only time in a discarded stage.
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

# public/ is optional and currently empty, and git does not track empty directories — so
# it exists in a working tree that once created it but not in a fresh clone. Without this
# the runner's `COPY /app/public` failed on CI while passing locally, which is the most
# misleading way for a build to break. Materialise it so the copy has a target either
# way, and so dropping a favicon in later needs no Dockerfile change.
RUN mkdir -p public

RUN pnpm build

# Guarantee the native addon is present in the standalone tree, and prove it loads.
#
# Next's tracer does currently pick up better-sqlite3's prebuilds/, but nothing in the
# source statically requires the .node file by path, so that is an implementation
# detail rather than a contract — and a silent regression would surface as a container
# that serves pages and cannot touch the database. Dereferencing the real package
# (pnpm leaves node_modules/better-sqlite3 as a symlink into the store, which COPY
# cannot usefully carry) and then requiring it turns that class of failure into a
# build error here instead.
RUN REAL="$(node -e "console.log(require('node:path').dirname(require.resolve('better-sqlite3/package.json')))")" \
 && mkdir -p .next/standalone/node_modules/better-sqlite3 \
 && cp -RL "$REAL/." .next/standalone/node_modules/better-sqlite3/ \
 && node -e "require('/app/.next/standalone/node_modules/better-sqlite3'); console.log('ok: better-sqlite3 loads from the standalone tree')"

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

RUN mkdir -p /data && chown -R watchman:watchman /data
VOLUME /data
USER watchman
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
