"use server";

import { revalidatePath } from "next/cache";
import { eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { maintenanceMonitors, maintenanceWindows } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { formString, formStrings, formTrimmed } from "@/lib/forms";

export interface MaintenanceActionState {
  error?: string;
  ok?: boolean;
}

/**
 * Schedule a maintenance window.
 *
 * Admin-only: suppressing alerts is the one action that can make Watchman go quiet
 * during a real outage, so it should not be something any member can do by accident.
 */
export async function createMaintenanceAction(
  _prev: MaintenanceActionState,
  formData: FormData,
): Promise<MaintenanceActionState> {
  const user = await requireAdmin();

  const title = formTrimmed(formData, "title");
  if (!title) return { error: "Give the window a title" };

  // datetime-local submits wall-clock time with no zone, which `new Date` reads as
  // local — the same clock the person filling in the form is looking at.
  const startsAt = new Date(formString(formData, "startsAt"));
  const endsAt = new Date(formString(formData, "endsAt"));

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { error: "Enter both a start and an end time" };
  }
  if (endsAt <= startsAt) return { error: "The end must come after the start" };

  const monitorIds = formStrings(formData, "monitorIds");
  if (monitorIds.length === 0) {
    // A window covering nothing silently does nothing, which is worse than an error.
    return { error: "Select at least one monitor" };
  }

  const suppressAlerts = formData.get("suppressAlerts") !== null;
  const pauseChecks = formData.get("pauseChecks") !== null;
  if (!suppressAlerts && !pauseChecks) {
    return { error: "Choose to suppress alerts, pause checks, or both" };
  }

  const created = db
    .insert(maintenanceWindows)
    .values({
      title,
      notes: formTrimmed(formData, "notes") || null,
      startsAt,
      endsAt,
      suppressAlerts,
      pauseChecks,
      createdBy: user.id,
    })
    .returning({ id: maintenanceWindows.id })
    .get();

  db.insert(maintenanceMonitors)
    .values(monitorIds.map((monitorId) => ({ windowId: created.id, monitorId })))
    .onConflictDoNothing()
    .run();

  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteMaintenanceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  // maintenance_monitors rows cascade from the schema.
  if (id) db.delete(maintenanceWindows).where(eq(maintenanceWindows.id, id)).run();
  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
}

/**
 * End a window early.
 *
 * Sets the end to now rather than deleting, so the record of *why* alerts were quiet
 * for that period survives — which is exactly what someone reading an incident
 * timeline afterwards needs.
 */
export async function endMaintenanceNowAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  if (!id) return;

  const window = db
    .select()
    .from(maintenanceWindows)
    .where(eq(maintenanceWindows.id, id))
    .get();
  if (!window) return;

  const now = new Date();
  db.update(maintenanceWindows)
    .set({
      endsAt: now,
      // A window ended before it began would read as nonsense in the list.
      startsAt: window.startsAt > now ? now : window.startsAt,
    })
    .where(eq(maintenanceWindows.id, id))
    .run();

  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
}

/** Drop windows that ended long ago, so the list stays readable. */
export async function pruneExpiredMaintenanceAction(): Promise<void> {
  await requireAdmin();
  db.delete(maintenanceWindows)
    .where(lt(maintenanceWindows.endsAt, new Date(Date.now() - 90 * 86_400_000)))
    .run();
  revalidatePath("/maintenance");
}
