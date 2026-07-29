/** Aggregation helpers shared by the dashboard, status pages, and badges. */

export type MonitorStatus = "up" | "degraded" | "down" | "paused" | "pending";

export interface LatencySample {
  ok: boolean;
  latencyMs?: number | null;
}

export interface Summary {
  total: number;
  upCount: number;
  degradedCount: number;
  downCount: number;
  uptimePct: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
}

/**
 * Nearest-rank percentile on an already-sorted ascending array.
 * Returns null for an empty input rather than 0 — "no data" and "0ms" are
 * different claims and the UI renders them differently.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank))]!;
}

/**
 * Summarise a window of check results.
 *
 * Latency percentiles intentionally consider *successful* checks only: a
 * connection that timed out at 30s would otherwise dominate p95 and hide the
 * real response-time trend of the requests that did work.
 */
export function summarize(
  samples: readonly LatencySample[],
  degradedThresholdMs?: number | null,
): Summary {
  let upCount = 0;
  let degradedCount = 0;
  let downCount = 0;
  const latencies: number[] = [];

  for (const s of samples) {
    if (!s.ok) {
      downCount++;
      continue;
    }
    if (typeof s.latencyMs === "number" && Number.isFinite(s.latencyMs)) {
      latencies.push(s.latencyMs);
      if (degradedThresholdMs && s.latencyMs > degradedThresholdMs) {
        degradedCount++;
        continue;
      }
    }
    upCount++;
  }

  const total = samples.length;
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);

  return {
    total,
    upCount,
    degradedCount,
    downCount,
    // Degraded still counts as available — it responded.
    uptimePct: total === 0 ? 0 : ((upCount + degradedCount) / total) * 100,
    avgMs: latencies.length ? sum / latencies.length : null,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    minMs: latencies.length ? latencies[0]! : null,
    maxMs: latencies.length ? latencies[latencies.length - 1]! : null,
  };
}

export interface SloBudget {
  targetPct: number;
  windowMs: number;
  /** Total downtime the target permits across the window. */
  allowedMs: number;
  /** Downtime observed so far. */
  consumedMs: number;
  /** Downtime still available before the objective is missed. Floors at 0. */
  remainingMs: number;
  /** 0 = untouched, 1 = exactly exhausted, >1 = objective already missed. */
  burnRatio: number;
  exhausted: boolean;
}

/**
 * Error-budget arithmetic. Framing downtime as a depleting allowance is far more
 * actionable than a bare percentage — "you have 4 minutes left this month" tells
 * you whether to ship on a Friday.
 */
export function sloBudget({
  uptimePct,
  targetPct,
  windowMs,
}: {
  uptimePct: number;
  targetPct: number;
  windowMs: number;
}): SloBudget {
  const allowedMs = windowMs * (1 - targetPct / 100);
  const consumedMs = windowMs * (1 - Math.min(100, Math.max(0, uptimePct)) / 100);
  const burnRatio = allowedMs <= 0 ? (consumedMs > 0 ? Infinity : 0) : consumedMs / allowedMs;
  return {
    targetPct,
    windowMs,
    allowedMs,
    consumedMs,
    remainingMs: Math.max(0, allowedMs - consumedMs),
    burnRatio,
    exhausted: consumedMs >= allowedMs && allowedMs >= 0,
  };
}

/** "99.95%" — trims trailing zeros but keeps meaningful precision near 100. */
export function formatUptime(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  if (pct === 100) return "100%";
  if (pct >= 99.99) return `${pct.toFixed(3)}%`;
  if (pct >= 99) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

/** "412ms" / "1.24s" — latency is read at a glance, so units switch at 1s. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** "3d 4h", "12m 30s" — compact human duration, max two units. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** "4m ago", "2d ago" */
export function formatAgo(at: Date | number | null | undefined): string {
  if (at === null || at === undefined) return "never";
  const ms = Date.now() - (at instanceof Date ? at.getTime() : at);
  if (ms < 5_000) return "just now";
  return `${formatDuration(ms)} ago`;
}

export const WINDOWS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "90d": 7_776_000_000,
} as const;

export type WindowKey = keyof typeof WINDOWS;
