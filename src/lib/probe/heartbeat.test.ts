import { describe, expect, it } from "vitest";
import { evaluateHeartbeat } from "./heartbeat";

const now = new Date("2026-01-01T12:00:00.000Z");
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

const evaluate = (opts: {
  lastPingAt: Date | null;
  intervalSec?: number;
  graceSec?: number;
  createdAt?: Date;
}) =>
  evaluateHeartbeat({
    intervalSec: 300,
    graceSec: 60,
    createdAt: now,
    now,
    ...opts,
  });

describe("evaluateHeartbeat", () => {
  it("is up when the last ping is well inside the interval", () => {
    const r = evaluate({ lastPingAt: ago(30) });
    expect(r.status).toBe("up");
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
  });

  it("is up exactly on the interval boundary", () => {
    expect(evaluate({ lastPingAt: ago(300) }).status).toBe("up");
  });

  // Late-but-within-grace is the common case for cron jitter and slow runs. It
  // should be visible without being an incident.
  it("degrades past the interval but inside the grace window", () => {
    const r = evaluate({ lastPingAt: ago(330) });
    expect(r.status).toBe("degraded");
    expect(r.ok).toBe(true);
    expect(r.error).toContain("late");
  });

  it("is still degraded on the last second of grace", () => {
    expect(evaluate({ lastPingAt: ago(360) }).status).toBe("degraded");
  });

  it("goes down once past interval plus grace", () => {
    const r = evaluate({ lastPingAt: ago(361) });
    expect(r.status).toBe("down");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("grace deadline");
  });

  it("reports how overdue a dead job is", () => {
    const r = evaluate({ lastPingAt: ago(900) });
    expect(r.error).toContain("540s past");
  });

  // A freshly created heartbeat must not alarm before its first expected ping —
  // otherwise every new monitor pages someone the moment it is saved.
  it("is up for a new monitor that has not yet reached its first deadline", () => {
    const r = evaluate({ lastPingAt: null, createdAt: ago(60) });
    expect(r.status).toBe("up");
  });

  it("goes down when the first ping never arrives in time", () => {
    const r = evaluate({ lastPingAt: null, createdAt: ago(900) });
    expect(r.status).toBe("down");
    expect(r.error).toContain("Never checked in");
  });

  it("exposes the countdown to the next expected ping", () => {
    const r = evaluate({ lastPingAt: ago(100) });
    expect(r.meta?.dueInSec).toBe(260);
    expect(r.meta?.elapsedSec).toBe(100);
  });

  it("honours a zero grace period", () => {
    expect(evaluate({ lastPingAt: ago(301), graceSec: 0 }).status).toBe("down");
    expect(evaluate({ lastPingAt: ago(299), graceSec: 0 }).status).toBe("up");
  });
});
