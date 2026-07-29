import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatMs,
  formatUptime,
  percentile,
  sloBudget,
  summarize,
} from "./uptime";

describe("percentile", () => {
  it("returns null for no data rather than 0", () => {
    // "no measurements" and "0ms" are different claims; the UI renders them
    // differently, so this must not collapse to a number.
    expect(percentile([], 95)).toBeNull();
  });

  it("returns the only value for a single sample", () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it("uses nearest-rank", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile(xs, 100)).toBe(10);
  });

  it("clamps out-of-range percentiles", () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 300)).toBe(3);
  });
});

describe("summarize", () => {
  it("returns zeroed output for an empty window", () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.uptimePct).toBe(0);
    expect(s.p95Ms).toBeNull();
  });

  it("counts availability", () => {
    const s = summarize([
      { ok: true, latencyMs: 100 },
      { ok: true, latencyMs: 120 },
      { ok: false },
      { ok: true, latencyMs: 110 },
    ]);
    expect(s.total).toBe(4);
    expect(s.downCount).toBe(1);
    expect(s.uptimePct).toBe(75);
  });

  // A slow response is still an available one. Counting degraded as downtime
  // would double-punish latency, which the grade already weighs separately.
  it("counts degraded as available", () => {
    const s = summarize(
      [
        { ok: true, latencyMs: 100 },
        { ok: true, latencyMs: 9000 },
      ],
      500,
    );
    expect(s.degradedCount).toBe(1);
    expect(s.upCount).toBe(1);
    expect(s.uptimePct).toBe(100);
  });

  // A 30s timeout would otherwise dominate p95 and hide the real trend of the
  // requests that actually succeeded.
  it("excludes failed checks from latency percentiles", () => {
    const s = summarize([
      { ok: true, latencyMs: 100 },
      { ok: true, latencyMs: 200 },
      { ok: false, latencyMs: 30_000 },
    ]);
    expect(s.maxMs).toBe(200);
    expect(s.avgMs).toBe(150);
  });

  it("tolerates successful checks with no latency (heartbeats)", () => {
    const s = summarize([{ ok: true }, { ok: true }]);
    expect(s.uptimePct).toBe(100);
    expect(s.p95Ms).toBeNull();
    expect(s.avgMs).toBeNull();
  });
});

describe("sloBudget", () => {
  const month = 30 * 86_400_000;

  it("computes the allowance for a 99.9% target", () => {
    const b = sloBudget({ uptimePct: 100, targetPct: 99.9, windowMs: month });
    // 0.1% of 30 days ≈ 43.2 minutes
    expect(Math.round(b.allowedMs / 60_000)).toBe(43);
    expect(b.consumedMs).toBe(0);
    expect(b.burnRatio).toBe(0);
    expect(b.exhausted).toBe(false);
  });

  it("tracks partial consumption", () => {
    const b = sloBudget({ uptimePct: 99.95, targetPct: 99.9, windowMs: month });
    expect(b.burnRatio).toBeCloseTo(0.5, 5);
    expect(b.exhausted).toBe(false);
    expect(b.remainingMs).toBeGreaterThan(0);
  });

  it("marks the objective as missed once the budget is gone", () => {
    const b = sloBudget({ uptimePct: 99.0, targetPct: 99.9, windowMs: month });
    expect(b.burnRatio).toBeGreaterThan(1);
    expect(b.exhausted).toBe(true);
    // Remaining floors at zero — a negative allowance is meaningless to display.
    expect(b.remainingMs).toBe(0);
  });

  it("handles a 100% target without dividing by zero", () => {
    const perfect = sloBudget({ uptimePct: 100, targetPct: 100, windowMs: month });
    expect(perfect.burnRatio).toBe(0);
    expect(perfect.exhausted).toBe(true);

    const broken = sloBudget({ uptimePct: 99.9, targetPct: 100, windowMs: month });
    expect(broken.burnRatio).toBe(Infinity);
  });
});

describe("formatters", () => {
  it("keeps precision near 100% and trims it lower down", () => {
    expect(formatUptime(100)).toBe("100%");
    expect(formatUptime(99.995)).toBe("99.995%");
    expect(formatUptime(99.9)).toBe("99.90%");
    expect(formatUptime(87.31)).toBe("87.3%");
    expect(formatUptime(NaN)).toBe("—");
  });

  it("switches latency units at one second", () => {
    expect(formatMs(0.4)).toBe("<1ms");
    expect(formatMs(412)).toBe("412ms");
    expect(formatMs(1240)).toBe("1.24s");
    expect(formatMs(null)).toBe("—");
  });

  it("shows at most two duration units", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
    expect(formatDuration(93_600_000)).toBe("1d 2h");
    expect(formatDuration(-1)).toBe("—");
  });
});
