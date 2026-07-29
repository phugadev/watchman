import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { checks, monitors, rollups } from "@/lib/db/schema";
import { percentile } from "@/lib/metrics/uptime";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Floor a timestamp to its UTC bucket start. */
export function bucketStart(at: number, bucket: "hour" | "day"): number {
  const size = bucket === "hour" ? HOUR_MS : DAY_MS;
  return Math.floor(at / size) * size;
}

/**
 * Aggregate raw checks into one bucket.
 *
 * Recomputed from scratch rather than incremented, and written with an upsert, so
 * running it twice over the same window is harmless. That matters because the
 * scheduler re-rolls the current bucket on every pass while it is still filling,
 * and because a crash mid-rollup must not leave a bucket half-counted.
 */
function aggregateBucket(
  monitorId: string,
  bucket: "hour" | "day",
  startMs: number,
): void {
  const size = bucket === "hour" ? HOUR_MS : DAY_MS;
  const start = new Date(startMs);
  const end = new Date(startMs + size);

  const rows = db
    .select({
      status: checks.status,
      latencyMs: checks.latencyMs,
    })
    .from(checks)
    .where(
      and(eq(checks.monitorId, monitorId), gte(checks.at, start), lt(checks.at, end)),
    )
    .all();

  if (rows.length === 0) return;

  let upCount = 0;
  let degradedCount = 0;
  let downCount = 0;
  const latencies: number[] = [];

  for (const r of rows) {
    if (r.status === "up") upCount++;
    else if (r.status === "degraded") degradedCount++;
    else downCount++;
    // Failed checks are excluded so a 30s timeout cannot dominate p95 and hide
    // the real trend of the requests that succeeded.
    if (r.status !== "down" && typeof r.latencyMs === "number") {
      latencies.push(r.latencyMs);
    }
  }

  latencies.sort((a, b) => a - b);
  const total = rows.length;

  /*
   * Downtime is estimated as (failed share × bucket duration) rather than summed
   * from real outage boundaries. Sampling every 60s cannot know when within a gap
   * the service actually died, and this estimator is unbiased at the bucket level,
   * which is what the SLO budget needs.
   */
  const downtimeMs = Math.round((downCount / total) * size);

  const values = {
    monitorId,
    bucket,
    startedAt: start,
    total,
    upCount,
    degradedCount,
    downCount,
    avgMs: latencies.length
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    minMs: latencies.length ? latencies[0]! : null,
    maxMs: latencies.length ? latencies[latencies.length - 1]! : null,
    downtimeMs,
  };

  db.insert(rollups)
    .values(values)
    .onConflictDoUpdate({
      target: [rollups.monitorId, rollups.bucket, rollups.startedAt],
      set: {
        total: values.total,
        upCount: values.upCount,
        degradedCount: values.degradedCount,
        downCount: values.downCount,
        avgMs: values.avgMs,
        p50Ms: values.p50Ms,
        p95Ms: values.p95Ms,
        p99Ms: values.p99Ms,
        minMs: values.minMs,
        maxMs: values.maxMs,
        downtimeMs: values.downtimeMs,
      },
    })
    .run();
}

/**
 * Roll up every monitor's recent buckets.
 *
 * The lookback covers the current bucket plus the previous one: the current
 * bucket is still filling and needs refreshing, and the previous may have gained
 * late-arriving rows (a slow probe that started before the boundary and finished
 * after it).
 */
export function rollupRecent(now = Date.now()): { hours: number; days: number } {
  const ids = db.select({ id: monitors.id }).from(monitors).all();
  let hours = 0;
  let days = 0;

  for (const { id } of ids) {
    for (const offset of [1, 0]) {
      aggregateBucket(id, "hour", bucketStart(now, "hour") - offset * HOUR_MS);
      hours++;
    }
    for (const offset of [1, 0]) {
      aggregateBucket(id, "day", bucketStart(now, "day") - offset * DAY_MS);
      days++;
    }
  }

  return { hours, days };
}

/**
 * Rebuild every bucket a monitor has data for. Used after a backfill or an
 * import, where the incremental path would miss historical windows.
 */
export function rollupMonitorFully(monitorId: string): number {
  const first = db
    .select({ at: checks.at })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(asc(checks.at))
    .limit(1)
    .get();

  if (!first) return 0;

  let count = 0;
  const now = Date.now();

  for (
    let t = bucketStart(first.at.getTime(), "hour");
    t <= now;
    t += HOUR_MS
  ) {
    aggregateBucket(monitorId, "hour", t);
    count++;
  }
  for (let t = bucketStart(first.at.getTime(), "day"); t <= now; t += DAY_MS) {
    aggregateBucket(monitorId, "day", t);
    count++;
  }

  return count;
}
