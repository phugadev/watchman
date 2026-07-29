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
 */
function resolveSecret(): string {
  const provided = process.env.WATCHMAN_SECRET;
  if (isProd) return required("WATCHMAN_SECRET", provided);
  if (provided) return provided;
  return createHash("sha256")
    .update(`watchman-dev-only:${process.env.WATCHMAN_DB_PATH ?? "default"}`)
    .digest("hex");
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
  secret: resolveSecret(),
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
    "Watchman/0.1 (+https://github.com/watchman)",
} as const;

export type Env = typeof env;
