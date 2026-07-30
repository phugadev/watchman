import { describe, expect, it } from "vitest";
import { asBucket, mergeBuckets, summarize, type BucketLike } from "./uptime";

const bucket = (over: Partial<BucketLike> = {}): BucketLike => ({
  total: 60,
  upCount: 60,
  degradedCount: 0,
  downCount: 0,
  avgMs: 100,
  p95Ms: 150,
  minMs: 80,
  maxMs: 200,
  ...over,
});

describe("mergeBuckets", () => {
  it("returns an empty summary for no buckets", () => {
    const s = mergeBuckets([]);
    expect(s.total).toBe(0);
    expect(s.uptimePct).toBe(0);
    expect(s.p95Ms).toBeNull();
  });

  it("sums counts across buckets", () => {
    const s = mergeBuckets([bucket(), bucket(), bucket()]);
    expect(s.total).toBe(180);
    expect(s.upCount).toBe(180);
    expect(s.uptimePct).toBe(100);
  });

  // Availability is only ever counting, so merging must be exact — this is the number
  // the SLO budget and the grade are built on.
  it("computes availability exactly", () => {
    const s = mergeBuckets([
      bucket({ total: 60, upCount: 60, downCount: 0 }),
      bucket({ total: 60, upCount: 30, downCount: 30 }),
    ]);
    expect(s.total).toBe(120);
    expect(s.downCount).toBe(30);
    expect(s.uptimePct).toBe(75);
  });

  it("counts degraded as available", () => {
    const s = mergeBuckets([bucket({ upCount: 50, degradedCount: 10, downCount: 0 })]);
    expect(s.uptimePct).toBe(100);
  });

  it("takes the true min and max across buckets", () => {
    const s = mergeBuckets([
      bucket({ minMs: 80, maxMs: 200 }),
      bucket({ minMs: 40, maxMs: 900 }),
    ]);
    expect(s.minMs).toBe(40);
    expect(s.maxMs).toBe(900);
  });

  it("weights p95 by sample count", () => {
    // A busy bucket at 100ms should dominate a near-empty one at 1000ms.
    const s = mergeBuckets([
      bucket({ total: 1000, upCount: 1000, p95Ms: 100 }),
      bucket({ total: 1, upCount: 1, p95Ms: 1000 }),
    ]);
    expect(s.p95Ms).toBeGreaterThan(100);
    expect(s.p95Ms).toBeLessThan(110);
  });

  // Percentiles are not recoverable from per-bucket percentiles. Returning null is the
  // honest answer; a guessed p50 would be indistinguishable from a measured one.
  it("refuses to invent p50 and p99", () => {
    const s = mergeBuckets([bucket()]);
    expect(s.p50Ms).toBeNull();
    expect(s.p99Ms).toBeNull();
    expect(s.p95Ms).not.toBeNull();
  });

  it("ignores null latencies instead of treating them as zero", () => {
    const s = mergeBuckets([
      bucket({ p95Ms: 200, avgMs: 150, minMs: null, maxMs: null }),
      // A heartbeat bucket carries counts but no latency at all.
      bucket({ p95Ms: null, avgMs: null, minMs: null, maxMs: null }),
    ]);
    expect(s.p95Ms).toBe(200);
    expect(s.avgMs).toBe(150);
  });

  it("survives a bucket with a zero total without dividing by zero", () => {
    const s = mergeBuckets([bucket({ total: 0, upCount: 0, p95Ms: 120 })]);
    expect(Number.isFinite(s.p95Ms!)).toBe(true);
    expect(s.uptimePct).toBe(0);
  });
});

describe("asBucket + mergeBuckets agreement with summarize", () => {
  const samples = [
    { ok: true, latencyMs: 100 },
    { ok: true, latencyMs: 120 },
    { ok: true, latencyMs: 3000 },
    { ok: false },
    { ok: true, latencyMs: 110 },
  ];

  // Folding raw checks through asBucket is how the current partial hour joins the
  // rollups. Availability must survive that round trip untouched.
  it("preserves availability exactly through a single bucket", () => {
    const direct = summarize(samples, 500);
    const merged = mergeBuckets([asBucket(samples, 500)]);

    expect(merged.total).toBe(direct.total);
    expect(merged.upCount).toBe(direct.upCount);
    expect(merged.degradedCount).toBe(direct.degradedCount);
    expect(merged.downCount).toBe(direct.downCount);
    expect(merged.uptimePct).toBe(direct.uptimePct);
    expect(merged.minMs).toBe(direct.minMs);
    expect(merged.maxMs).toBe(direct.maxMs);
  });

  it("preserves p95 exactly when there is only one bucket", () => {
    const direct = summarize(samples, 500);
    const merged = mergeBuckets([asBucket(samples, 500)]);
    expect(merged.p95Ms).toBe(direct.p95Ms);
  });
});
