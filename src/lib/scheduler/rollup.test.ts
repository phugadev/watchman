import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, bucketStart } from "./rollup";

describe("bucketStart", () => {
  it("floors to the containing hour", () => {
    const at = Date.UTC(2026, 6, 30, 14, 37, 52, 431);
    expect(bucketStart(at, "hour")).toBe(Date.UTC(2026, 6, 30, 14, 0, 0, 0));
  });

  it("floors to the containing UTC day", () => {
    const at = Date.UTC(2026, 6, 30, 14, 37, 52, 431);
    expect(bucketStart(at, "day")).toBe(Date.UTC(2026, 6, 30, 0, 0, 0, 0));
  });

  it("is idempotent on an exact boundary", () => {
    const boundary = Date.UTC(2026, 6, 30, 14, 0, 0, 0);
    expect(bucketStart(boundary, "hour")).toBe(boundary);
    const midnight = Date.UTC(2026, 6, 30, 0, 0, 0, 0);
    expect(bucketStart(midnight, "day")).toBe(midnight);
  });

  // Rollups are upserted by (monitor, bucket, startedAt), so two timestamps in the
  // same period must produce the identical key or the same window would be stored
  // twice under different starts.
  it("maps every instant in a period to one key", () => {
    const base = Date.UTC(2026, 6, 30, 9, 0, 0, 0);
    const keys = new Set(
      [0, 1, 999, 60_000, HOUR_MS - 1].map((offset) =>
        bucketStart(base + offset, "hour"),
      ),
    );
    expect(keys.size).toBe(1);
    expect(bucketStart(base + HOUR_MS, "hour")).toBe(base + HOUR_MS);
  });

  it("handles the epoch and pre-epoch instants without drifting forward", () => {
    expect(bucketStart(0, "hour")).toBe(0);
    expect(bucketStart(0, "day")).toBe(0);
    // Math.floor rounds toward -Infinity, which is what "the containing bucket"
    // means for a negative timestamp.
    expect(bucketStart(-1, "day")).toBe(-DAY_MS);
  });
});
