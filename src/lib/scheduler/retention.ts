import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { checks, notifications, rollups, sessions } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * Prune old data.
 *
 * Raw checks are the only table that grows without bound: one monitor on a
 * 60-second interval writes ~43k rows a month, and a fleet of thirty makes that
 * 1.3M. Rollups preserve the shape of that history at a thousandth of the size, so
 * raw rows are dropped once they fall out of the detailed-view window.
 *
 * Incidents and their timelines are never pruned. They are the audit trail, they
 * are small, and losing them silently would be worse than the disk they cost.
 */
export function pruneOldData(now = Date.now()): {
  checks: number;
  hourlyRollups: number;
  dailyRollups: number;
  notifications: number;
  sessions: number;
} {
  const rawCutoff = new Date(now - env.rawRetentionDays * 86_400_000);
  const hourCutoff = new Date(now - env.hourlyRetentionDays * 86_400_000);
  const dayCutoff = new Date(now - env.dailyRetentionDays * 86_400_000);
  // Delivery logs answer "was I paged?", which stops being asked long before the
  // incident record stops mattering.
  const notifCutoff = new Date(now - 90 * 86_400_000);

  const deleted = {
    checks: db.delete(checks).where(lt(checks.at, rawCutoff)).run().changes,
    hourlyRollups: db
      .delete(rollups)
      .where(and(eq(rollups.bucket, "hour"), lt(rollups.startedAt, hourCutoff)))
      .run().changes,
    dailyRollups: db
      .delete(rollups)
      .where(and(eq(rollups.bucket, "day"), lt(rollups.startedAt, dayCutoff)))
      .run().changes,
    notifications: db
      .delete(notifications)
      .where(lt(notifications.at, notifCutoff))
      .run().changes,
    sessions: db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date(now)))
      .run().changes,
  };

  return deleted;
}

/**
 * Reclaim disk after a large prune.
 *
 * SQLite keeps freed pages for reuse rather than shrinking the file, so a database
 * that once held millions of checks stays large forever without this. It rewrites
 * the whole file and takes a write lock, so it runs rarely and only after a prune
 * that actually removed a meaningful number of rows.
 */
export function vacuum(): void {
  db.run("VACUUM");
}
