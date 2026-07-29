/**
 * Which part of its lifecycle a maintenance window is in.
 *
 * Derived from the clock rather than stored as a column, so it can never drift out of
 * sync — a persisted status would need a job to keep it honest, and a window stuck on
 * "active" would suppress alerts forever.
 *
 * Both bounds are inclusive, matching the `startsAt <= now AND endsAt >= now` query the
 * incident engine uses to decide suppression. The two must agree, or the UI would claim
 * a window is finished while alerts are still being withheld.
 */
export type MaintenancePhase = "active" | "scheduled" | "finished";

export function maintenancePhase(
  startsAt: Date,
  endsAt: Date,
  now: Date = new Date(),
): MaintenancePhase {
  if (startsAt.getTime() > now.getTime()) return "scheduled";
  if (endsAt.getTime() < now.getTime()) return "finished";
  return "active";
}
