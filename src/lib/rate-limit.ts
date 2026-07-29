/**
 * A fixed-window in-memory rate limiter.
 *
 * Deliberately process-local: Watchman is a single-container deployment, so there
 * is no second instance to coordinate with and no reason to require Redis. If a
 * clustered mode ever lands this becomes the one thing that needs a shared store.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Evict stale buckets so an attacker cycling identifiers cannot grow the map. */
function sweep(now: number): void {
  if (buckets.size < 512) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  existing.count++;
  const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterSec };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSec };
}

/** Clear a bucket after a legitimate success, so one bad typo is not punished. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Exposed for tests. */
export function _clearAllRateLimits(): void {
  buckets.clear();
}
