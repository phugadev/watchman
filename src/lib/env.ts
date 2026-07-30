import { createHash } from "node:crypto";

/**
 * Runtime configuration. Read once at module load so a bad config fails fast on
 * boot rather than on the first request that happens to need it.
 */

const isProd = process.env.NODE_ENV === "production";

function required(name: string, value: string | undefined): string {
  if (value && value.length > 0) return value;
  throw new Error(
    `[watchman] ${name} is required in production. Generate one with: openssl rand -hex 32`,
  );
}

/**
 * The signing secret for session cookies, webhook HMACs, and token hashing.
 *
 * In development an unset secret is derived deterministically from the database
 * path, so sessions survive a dev-server restart without anyone having to set up
 * a .env just to click around. In production it is mandatory — a predictable
 * secret would let anyone forge a session cookie.
 *
 * Resolved lazily and memoised rather than at module load. `next build` runs with
 * NODE_ENV=production and imports every route to collect page data, so eager
 * resolution would make a *build* require a runtime secret it has no use for. The
 * fail-fast check lives in instrumentation.ts instead, which runs when the server
 * actually starts serving.
 */
let cachedSecret: string | undefined;

function resolveSecret(): string {
  if (cachedSecret !== undefined) return cachedSecret;

  const provided = process.env.WATCHMAN_SECRET;
  if (isProd) {
    cachedSecret = required("WATCHMAN_SECRET", provided);
  } else if (provided) {
    cachedSecret = provided;
  } else {
    cachedSecret = createHash("sha256")
      .update(`watchman-dev-only:${process.env.WATCHMAN_DB_PATH ?? "default"}`)
      .digest("hex");
  }

  return cachedSecret;
}

const num = (value: string | undefined, fallback: number): number => {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export const env = {
  isProd,
  get secret(): string {
    return resolveSecret();
  },
  dbPath: process.env.WATCHMAN_DB_PATH ?? "./data/watchman.db",

  /** Public origin. Used to build heartbeat URLs and status-page links. */
  publicUrl: (
    process.env.WATCHMAN_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`
  ).replace(/\/$/, ""),

  /** Set false to run a read-only replica or a web-only process. */
  schedulerEnabled: bool(process.env.WATCHMAN_SCHEDULER, true),

  /** How often the scheduler wakes to look for due monitors. */
  tickMs: num(process.env.WATCHMAN_TICK_MS, 5_000),

  /** Maximum probes running at once. Keeps a wide fleet from exhausting sockets. */
  maxConcurrentChecks: num(process.env.WATCHMAN_MAX_CONCURRENCY, 12),

  /** Raw check rows older than this are pruned; rollups keep the long history. */
  rawRetentionDays: num(process.env.WATCHMAN_RAW_RETENTION_DAYS, 14),
  hourlyRetentionDays: num(process.env.WATCHMAN_HOURLY_RETENTION_DAYS, 90),
  dailyRetentionDays: num(process.env.WATCHMAN_DAILY_RETENTION_DAYS, 730),

  sessionTtlDays: num(process.env.WATCHMAN_SESSION_TTL_DAYS, 30),
  inviteTtlHours: num(process.env.WATCHMAN_INVITE_TTL_HOURS, 72),

  /** Allow anonymous read access to the dashboard (single-user homelab setups). */
  publicDashboard: bool(process.env.WATCHMAN_PUBLIC_DASHBOARD, false),

  /** Identifies Watchman's probes in target access logs. */
  userAgent:
    process.env.WATCHMAN_USER_AGENT ??
    "Watchman/0.1 (+https://github.com/phugadev/watchman)",
} as const;

export type Env = typeof env;

/**
 * Validate configuration that must be present to serve traffic.
 *
 * Called from instrumentation.ts on server start, so a container missing its secret
 * dies immediately and visibly rather than at whatever later moment someone first
 * tries to sign in.
 */
export function assertRuntimeConfig(): void {
  // Touching the getter is what forces resolution — and the throw, if it is unset.
  void env.secret;

  // Test what was actually configured, not what it resolved to. Checking the resolved
  // URL for "localhost" told anyone deliberately running on localhost that their
  // WATCHMAN_URL was unset, which was simply untrue.
  if (isProd && !process.env.WATCHMAN_URL) {
    console.warn(
      `[watchman] WATCHMAN_URL is unset, defaulting to ${env.publicUrl} — heartbeat URLs and status-page links will point there, which is wrong from any other machine`,
    );
  }
}
