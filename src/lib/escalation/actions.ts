"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  channels,
  escalationPolicies,
  escalationSteps,
  monitors,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { formOptional, formString, formTrimmed } from "@/lib/forms";

export interface EscalationActionState {
  error?: string;
  ok?: boolean;
}

/**
 * Escalation is admin-only for the same reason channels are: it decides who gets
 * woken up, and by which route.
 */

export async function createPolicyAction(
  _prev: EscalationActionState,
  formData: FormData,
): Promise<EscalationActionState> {
  await requireAdmin();

  const name = formTrimmed(formData, "name");
  if (!name) return { error: "Give the policy a name" };
  if (name.length > 80) return { error: "That name is too long" };

  const repeat = parseRepeat(formOptional(formData, "repeatSec"));
  if (repeat.error) return { error: repeat.error };

  db.insert(escalationPolicies)
    .values({ name, repeatSec: repeat.value })
    .run();

  revalidatePath("/channels");
  return { ok: true };
}

export async function updatePolicyAction(
  _prev: EscalationActionState,
  formData: FormData,
): Promise<EscalationActionState> {
  await requireAdmin();

  const id = formString(formData, "id");
  const name = formTrimmed(formData, "name");
  if (!id) return { error: "Missing policy" };
  if (!name) return { error: "Give the policy a name" };

  const repeat = parseRepeat(formOptional(formData, "repeatSec"));
  if (repeat.error) return { error: repeat.error };

  db.update(escalationPolicies)
    .set({ name, repeatSec: repeat.value })
    .where(eq(escalationPolicies.id, id))
    .run();

  revalidatePath("/channels");
  return { ok: true };
}

export async function addStepAction(
  _prev: EscalationActionState,
  formData: FormData,
): Promise<EscalationActionState> {
  await requireAdmin();

  const policyId = formString(formData, "policyId");
  const channelId = formString(formData, "channelId");
  if (!policyId) return { error: "Missing policy" };
  if (!channelId) return { error: "Pick a channel to notify" };

  const policy = db
    .select()
    .from(escalationPolicies)
    .where(eq(escalationPolicies.id, policyId))
    .get();
  if (!policy) return { error: "That policy no longer exists" };

  const channel = db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, channelId))
    .get();
  if (!channel) return { error: "That channel no longer exists" };

  const afterSec = Number(formTrimmed(formData, "afterSec", "0"));
  if (!Number.isFinite(afterSec) || afterSec < 0 || afterSec > 86_400) {
    return { error: "The delay must be between 0 and 86400 seconds" };
  }

  // Position is append-only ordering; the delay is what actually schedules a
  // step, so two steps sharing a delay simply both fire at that moment.
  const highest =
    db
      .select({ n: sql<number>`coalesce(max(${escalationSteps.position}), 0)` })
      .from(escalationSteps)
      .where(eq(escalationSteps.policyId, policyId))
      .get()?.n ?? 0;

  db.insert(escalationSteps)
    .values({
      policyId,
      position: highest + 1,
      afterSec: Math.round(afterSec),
      channelId,
    })
    .run();

  revalidatePath("/channels");
  return { ok: true };
}

export async function deleteStepAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  if (!id) return;

  const step = db
    .select()
    .from(escalationSteps)
    .where(eq(escalationSteps.id, id))
    .get();
  if (!step) return;

  db.transaction((tx) => {
    tx.delete(escalationSteps).where(eq(escalationSteps.id, id)).run();

    // Close the gap. Positions with a hole in them still work — the planner sorts
    // rather than indexes — but "step 1, step 3" reads like something is missing,
    // and incident timelines quote these numbers back to people.
    const remaining = tx
      .select()
      .from(escalationSteps)
      .where(eq(escalationSteps.policyId, step.policyId))
      .orderBy(escalationSteps.position)
      .all();

    remaining.forEach((row, index) => {
      if (row.position !== index + 1) {
        tx.update(escalationSteps)
          .set({ position: index + 1 })
          .where(eq(escalationSteps.id, row.id))
          .run();
      }
    });
  });

  revalidatePath("/channels");
}

export async function deletePolicyAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  if (!id) return;

  db.transaction((tx) => {
    /*
     * Detach the monitors first, by hand.
     *
     * The column is declared `onDelete: "set null"`, but SQLite cannot attach a
     * referential action to a column added by ALTER TABLE — the generated
     * migration emits a bare REFERENCES, which defaults to NO ACTION. With
     * `foreign_keys = ON` that turns deleting an in-use policy into a constraint
     * error instead of the intended detach. Doing it explicitly keeps the
     * behaviour the schema describes, and losing a policy never stops a monitor
     * alerting at all.
     */
    tx.update(monitors)
      .set({ escalationPolicyId: null })
      .where(eq(monitors.escalationPolicyId, id))
      .run();

    // Steps do cascade — that foreign key was declared at table creation.
    tx.delete(escalationPolicies).where(eq(escalationPolicies.id, id)).run();
  });

  revalidatePath("/channels");
  revalidatePath("/monitors");
}

/**
 * Parse the repeat interval.
 *
 * Empty means "do not repeat", which is the default and the quiet option. The
 * 60-second floor is there because a policy repeating every few seconds is not an
 * escalation, it is a denial of service against your own on-call.
 */
function parseRepeat(raw: string | null): { value: number | null; error?: string } {
  if (raw === null || raw.trim() === "") return { value: null };

  const n = Number(raw);
  if (!Number.isFinite(n)) return { value: null, error: "Enter a number of seconds" };
  if (n === 0) return { value: null };
  if (n < 60) {
    return { value: null, error: "Repeat no more often than every 60 seconds" };
  }
  if (n > 86_400) return { value: null, error: "That is longer than a day" };

  return { value: Math.round(n) };
}
