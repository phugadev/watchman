/**
 * Server bootstrap.
 *
 * Next calls `register` once per server process, before handling any request,
 * which makes it the right place to start the probe loop. Starting it lazily from
 * a route handler instead would mean a fresh container monitors nothing until
 * somebody happens to load a page.
 */
export async function register(): Promise<void> {
  // The Edge runtime has no timers, sockets, or SQLite — the scheduler is
  // Node-only, and this module is evaluated in both.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startScheduler } = await import("@/lib/scheduler");
  const { db } = await import("@/lib/db");
  const { monitors } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  /*
   * Clear stale next-run reservations for monitors whose slot passed while the
   * process was down. checkMonitor reserves its next slot before probing, so a
   * crash mid-check would otherwise leave that monitor waiting a full interval
   * past its reservation before anyone noticed.
   */
  db.update(monitors)
    .set({ nextRunAt: null })
    .where(eq(monitors.paused, false))
    .run();

  startScheduler();
}
