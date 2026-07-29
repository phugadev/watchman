import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitors } from "@/lib/db/schema";
import { schedulerStatus } from "@/lib/scheduler";

/**
 * Liveness and readiness for the container healthcheck.
 *
 * Reports unhealthy when the scheduler has stalled, not merely when the web server
 * answers. A monitoring tool whose probe loop has died while still serving pages is
 * worse than one that is plainly down: the dashboard stays green because nothing is
 * updating it. An orchestrator should restart that.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const scheduler = schedulerStatus();

  let dbOk = true;
  let monitorCount = 0;
  try {
    monitorCount =
      db.select({ n: sql<number>`count(*)` }).from(monitors).get()?.n ?? 0;
  } catch {
    dbOk = false;
  }

  // Allow ten missed ticks before calling it stalled, so a slow batch of probes
  // does not trigger a restart.
  const staleAfterMs = Math.max(60_000, scheduler.tickMs * 10);
  const stalled =
    scheduler.running &&
    scheduler.lastTickAt !== null &&
    Date.now() - scheduler.lastTickAt > staleAfterMs;

  const healthy = dbOk && !stalled;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      db: dbOk ? "ok" : "error",
      scheduler: {
        running: scheduler.running,
        enabled: scheduler.enabled,
        stalled,
        ticks: scheduler.ticks,
        inFlight: scheduler.inFlight,
        lastTickAt: scheduler.lastTickAt,
      },
      monitors: monitorCount,
      uptimeMs: Math.round(process.uptime() * 1000),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
