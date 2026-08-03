import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { checks, monitors, type Monitor } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { recordCheck, maintenanceState } from "@/lib/incidents/engine";
import { sweepEscalations } from "@/lib/incidents/sweep";
import { evaluateHeartbeat, runProbe, specFromMonitor } from "@/lib/probe";
import { pruneOldData, vacuum } from "./retention";
import { rollupRecent } from "./rollup";

/**
 * The scheduler.
 *
 * A single in-process timer, not a queue and not a cron. That is a deliberate
 * consequence of shipping as one container: BullMQ would mean Redis, and a
 * cron-per-monitor cannot express sub-minute intervals. A tick loop over a
 * `next_run_at` column gives per-monitor intervals, survives restarts, and needs
 * nothing but the database that is already there.
 */

interface SchedulerState {
  timer: NodeJS.Timeout | null;
  running: Set<string>;
  ticks: number;
  lastTickAt: number | null;
  startedAt: number | null;
  lastRollupAt: number;
  lastPruneAt: number;
  lastEscalationAt: number;
}

// Cached on globalThis so dev HMR reuses one loop instead of accumulating timers.
const globalForScheduler = globalThis as unknown as {
  __watchmanScheduler?: SchedulerState;
};

const state: SchedulerState = (globalForScheduler.__watchmanScheduler ??= {
  timer: null,
  running: new Set(),
  ticks: 0,
  lastTickAt: null,
  startedAt: null,
  lastRollupAt: 0,
  lastPruneAt: 0,
  lastEscalationAt: 0,
});

const ROLLUP_EVERY_MS = 60_000;
const PRUNE_EVERY_MS = 6 * 3_600_000;

/**
 * How often to look for incidents due an escalation.
 *
 * Not every tick: the sweep is a join the check path does not need, and 15s of
 * granularity on a step measured in minutes is not worth the query. A step set to
 * fire at 60s therefore fires somewhere in 60–75s.
 */
const ESCALATION_EVERY_MS = 15_000;

/** Run one monitor's check and persist the outcome. */
async function checkMonitor(monitor: Monitor): Promise<void> {
  if (state.running.has(monitor.id)) return;
  state.running.add(monitor.id);

  try {
    // Reserve the next slot *before* probing. If the process dies mid-check the
    // monitor resumes on its normal cadence instead of being retried immediately
    // on every restart.
    const nextRunAt = new Date(Date.now() + monitor.intervalSec * 1000);
    db.update(monitors)
      .set({ nextRunAt })
      .where(eq(monitors.id, monitor.id))
      .run();

    const result =
      monitor.kind === "heartbeat"
        ? evaluateHeartbeat({
            lastPingAt: monitor.lastCheckedAt,
            intervalSec: monitor.intervalSec,
            graceSec: monitor.graceSec,
            createdAt: monitor.createdAt,
          })
        : await runProbe(specFromMonitor(monitor));

    /*
     * Heartbeats are evaluated, not probed, so a passing evaluation carries no new
     * information — the ping route already recorded the check when the job called
     * in. Writing another row here would inflate the check count and make the
     * uptime tape denser than the job's actual schedule. Only the transition into
     * late-or-dead is worth persisting.
     */
    if (monitor.kind === "heartbeat" && result.ok && result.status === "up") {
      return;
    }

    await recordCheck(monitor, result);
  } catch (err) {
    // A probe that throws is a bug in Watchman, not an outage at the target.
    // Never let it kill the loop.
    console.error(
      `[watchman] check failed unexpectedly for ${monitor.name} (${monitor.id})`,
      err,
    );
  } finally {
    state.running.delete(monitor.id);
  }
}

/** Select monitors that are due, respecting pause and maintenance state. */
function dueMonitors(limit: number): Monitor[] {
  const now = new Date();
  return db
    .select()
    .from(monitors)
    .where(
      and(
        eq(monitors.paused, false),
        // A monitor with no next_run_at has never run: pick it up immediately.
        or(isNull(monitors.nextRunAt), lte(monitors.nextRunAt, now)),
      ),
    )
    // Oldest-due first, so a backlog after downtime drains fairly instead of
    // starving whichever monitor sorts last.
    .orderBy(sql`coalesce(${monitors.nextRunAt}, 0) asc`)
    .limit(limit)
    .all();
}

async function tick(): Promise<void> {
  state.ticks++;
  state.lastTickAt = Date.now();

  try {
    const capacity = env.maxConcurrentChecks - state.running.size;
    if (capacity > 0) {
      const due = dueMonitors(capacity).filter(
        // `pauseChecks` windows stop probing entirely, for maintenance where the
        // service is intentionally offline.
        (m) => !maintenanceState(m.id).pauseChecks,
      );
      // Fire concurrently: a 10s timeout on one monitor must not delay the other
      // twenty that were due in the same tick.
      await Promise.allSettled(due.map((m) => checkMonitor(m)));
    }

    const now = Date.now();

    if (now - state.lastEscalationAt > ESCALATION_EVERY_MS) {
      state.lastEscalationAt = now;
      // Awaited rather than fired and forgotten, so a slow channel shows up as a
      // slow tick instead of as overlapping sweeps double-paging the same step.
      await sweepEscalations(new Date(now));
    }

    if (now - state.lastRollupAt > ROLLUP_EVERY_MS) {
      state.lastRollupAt = now;
      rollupRecent(now);
    }

    if (now - state.lastPruneAt > PRUNE_EVERY_MS) {
      state.lastPruneAt = now;
      const pruned = pruneOldData(now);
      const total = Object.values(pruned).reduce((a, b) => a + b, 0);
      if (total > 0) {
        console.log(
          `[watchman] pruned ${pruned.checks} checks, ${pruned.hourlyRollups + pruned.dailyRollups} rollups, ${pruned.notifications} deliveries`,
        );
      }
      // Only worth the full-file rewrite after a substantial prune.
      if (pruned.checks > 50_000) vacuum();
    }
  } catch (err) {
    console.error("[watchman] scheduler tick failed", err);
  }
}

export function startScheduler(): void {
  if (state.timer) return;
  if (!env.schedulerEnabled) {
    console.log("[watchman] scheduler disabled by WATCHMAN_SCHEDULER");
    return;
  }

  state.startedAt = Date.now();

  /*
   * Stagger the first tick. A restart during an outage would otherwise probe every
   * overdue monitor at once, which for a large fleet means a burst of simultaneous
   * connections at the exact moment the network is least healthy.
   */
  setTimeout(() => {
    void tick();
    state.timer = setInterval(() => void tick(), env.tickMs);
    // Never hold the process open for the sake of the timer.
    state.timer.unref?.();
  }, 1_500);

  console.log(
    `[watchman] scheduler started — tick ${env.tickMs}ms, max ${env.maxConcurrentChecks} concurrent`,
  );
}

export function stopScheduler(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/** Probe one monitor immediately, for the "Check now" button. */
export async function checkNow(monitorId: string): Promise<void> {
  const monitor = db
    .select()
    .from(monitors)
    .where(eq(monitors.id, monitorId))
    .get();
  if (monitor) await checkMonitor(monitor);
}

export function schedulerStatus() {
  const lastCheck = db
    .select({ at: sql<number>`max(${checks.at})` })
    .from(checks)
    .get();

  return {
    running: state.timer !== null,
    enabled: env.schedulerEnabled,
    ticks: state.ticks,
    inFlight: state.running.size,
    lastTickAt: state.lastTickAt,
    startedAt: state.startedAt,
    uptimeMs: state.startedAt ? Date.now() - state.startedAt : 0,
    lastCheckAt: lastCheck?.at ?? null,
    tickMs: env.tickMs,
    maxConcurrent: env.maxConcurrentChecks,
  };
}
