import { describe, expect, it } from "vitest";
import { computeGrade } from "./grade";

describe("computeGrade", () => {
  it("awards S for a flawless monitor", () => {
    const r = computeGrade({ uptimePct: 100, p95Ms: 90, incidentsPer30d: 0 });
    expect(r.grade).toBe("S");
    expect(r.score).toBeGreaterThanOrEqual(95);
  });

  it("awards F for a monitor that is mostly down", () => {
    expect(
      computeGrade({ uptimePct: 45, p95Ms: 5000, incidentsPer30d: 20 }).grade,
    ).toBe("F");
  });

  // The whole point of grading: two uptimes that look alike must not score alike.
  it("separates 99.9% from 99.5% clearly", () => {
    const good = computeGrade({ uptimePct: 99.9, p95Ms: 200, incidentsPer30d: 1 });
    const worse = computeGrade({ uptimePct: 99.5, p95Ms: 200, incidentsPer30d: 1 });
    expect(good.score - worse.score).toBeGreaterThan(5);
  });

  it("is monotonic in uptime", () => {
    const scores = [90, 95, 99, 99.5, 99.9, 100].map(
      (u) => computeGrade({ uptimePct: u, p95Ms: 200, incidentsPer30d: 0 }).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
    }
  });

  it("is monotonically worse as latency grows", () => {
    const scores = [100, 300, 900, 3000, 8000].map(
      (p) => computeGrade({ uptimePct: 100, p95Ms: p, incidentsPer30d: 0 }).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    }
  });

  // Ten brief outages and one long one can produce identical uptime, but they are
  // not equally healthy — flapping has to cost something.
  it("penalises frequent incidents at equal uptime", () => {
    const stable = computeGrade({ uptimePct: 99.9, p95Ms: 200, incidentsPer30d: 1 });
    const flappy = computeGrade({ uptimePct: 99.9, p95Ms: 200, incidentsPer30d: 10 });
    expect(flappy.score).toBeLessThan(stable.score);
    expect(flappy.grade).not.toBe(stable.grade);
  });

  it("redistributes latency weight when latency is unavailable", () => {
    const withoutLatency = computeGrade({
      uptimePct: 100,
      p95Ms: null,
      incidentsPer30d: 0,
    });
    // A heartbeat with perfect uptime and no incidents must still be able to
    // reach S; scoring its missing latency as zero would cap it at B.
    expect(withoutLatency.grade).toBe("S");
    expect(withoutLatency.parts.latency).toBeNull();
  });

  it("clamps nonsensical input instead of producing NaN", () => {
    expect(computeGrade({ uptimePct: 140, p95Ms: -5 }).score).toBeLessThanOrEqual(100);
    expect(computeGrade({ uptimePct: -20 }).grade).toBe("F");
    expect(
      Number.isFinite(computeGrade({ uptimePct: 99, incidentsPer30d: -3 }).score),
    ).toBe(true);
  });

  it("never returns a score outside 0–100", () => {
    for (const u of [0, 50, 99.999, 100]) {
      for (const p of [0, 1000, 100000]) {
        const s = computeGrade({ uptimePct: u, p95Ms: p, incidentsPer30d: 3 }).score;
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });
});
