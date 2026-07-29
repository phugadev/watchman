import type { ProbeResult } from "./types";

/**
 * Heartbeat — a dead man's switch, and the inverse of every other probe here.
 *
 * Watchman does not reach out; the job reaches in, by hitting its ping URL when
 * it finishes. This catches the failure mode active monitoring is blind to: a
 * backup script, a cron job, or a queue worker that simply stopped running. There
 * is no endpoint to poll for "did last night's backup happen", and a silent
 * absence of work produces no errors anywhere.
 *
 * Evaluation is pure — it reads a timestamp and returns a verdict — so the
 * interesting boundaries are trivially testable.
 */
export function evaluateHeartbeat({
  lastPingAt,
  intervalSec,
  graceSec,
  createdAt,
  now = new Date(),
}: {
  /** When the job last checked in. Null if it never has. */
  lastPingAt: Date | null;
  /** How often the job is expected to report. */
  intervalSec: number;
  /** Additional lateness tolerated before declaring it dead. */
  graceSec: number;
  /** Monitor creation time, used as the deadline before the first ping. */
  createdAt: Date;
  now?: Date;
}): ProbeResult {
  const deadlineMs = (intervalSec + graceSec) * 1000;
  // Before the first ping, the clock runs from when the monitor was created —
  // otherwise a newly added heartbeat would alarm immediately, every time.
  const reference = lastPingAt ?? createdAt;
  const elapsedMs = now.getTime() - reference.getTime();
  const overdueMs = elapsedMs - deadlineMs;

  const meta = {
    lastPingAt: lastPingAt?.toISOString() ?? null,
    expectedEverySec: intervalSec,
    graceSec,
    elapsedSec: Math.round(elapsedMs / 1000),
    dueInSec: Math.round(-overdueMs / 1000),
  };

  if (overdueMs > 0) {
    const lateSec = Math.round(overdueMs / 1000);
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: lastPingAt
        ? `No ping for ${Math.round(elapsedMs / 1000)}s — ${lateSec}s past the ${intervalSec}s + ${graceSec}s grace deadline`
        : `Never checked in — ${lateSec}s past the first expected ping`,
      meta,
    };
  }

  // Inside the deadline but into the grace period: the job is late, not dead.
  // Worth surfacing, not worth paging for.
  if (lastPingAt && elapsedMs > intervalSec * 1000) {
    return {
      ok: true,
      status: "degraded",
      latencyMs: null,
      error: `Ping is ${Math.round((elapsedMs - intervalSec * 1000) / 1000)}s late (within grace)`,
      meta,
    };
  }

  return {
    ok: true,
    status: lastPingAt ? "up" : "up",
    latencyMs: null,
    error: null,
    meta,
  };
}
