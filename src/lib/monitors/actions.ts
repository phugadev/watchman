"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitorChannels, monitors } from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { newHeartbeatToken } from "@/lib/ids";
import { rateLimit } from "@/lib/rate-limit";
import { checkNow } from "@/lib/scheduler";
import { rollupMonitorFully } from "@/lib/scheduler/rollup";
import { monitorFormSchema, parseHeaderLines } from "./schema";
import { parseTags, serialiseTags } from "./tags";
import { formBool, formOptional, formString, formStrings } from "@/lib/forms";

export interface MonitorActionState {
  error?: string;
  /** Field-level errors, keyed by form field name. */
  fieldErrors?: Record<string, string>;
}

/** Translate a FormData submission into validated values. */
function readForm(formData: FormData) {
  const raw = {
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    kind: formString(formData, "kind", "http"),
    target: formString(formData, "target"),
    method: formString(formData, "method", "GET"),
    headers: formString(formData, "headers"),
    body: formString(formData, "body"),
    expectedStatus: formString(formData, "expectedStatus", "2xx"),
    keyword: formString(formData, "keyword"),
    keywordMode: formString(formData, "keywordMode", "contains"),
    followRedirects: formBool(formData, "followRedirects"),
    verifyTls: formBool(formData, "verifyTls"),
    intervalSec: formString(formData, "intervalSec", "60"),
    timeoutMs: formString(formData, "timeoutMs", "10000"),
    confirmFailures: formString(formData, "confirmFailures", "2"),
    confirmRecoveries: formString(formData, "confirmRecoveries", "2"),
    // An empty degraded field means "no threshold", which is not the same as 0.
    degradedMs: formOptional(formData, "degradedMs"),
    graceSec: formString(formData, "graceSec", "120"),
    sslWarnDays: formString(formData, "sslWarnDays", "21"),
    dnsRecordType: formString(formData, "dnsRecordType", "A"),
    dnsExpected: formString(formData, "dnsExpected"),
    dnsMatchMode: formString(formData, "dnsMatchMode", "contains"),
    dnsResolver: formString(formData, "dnsResolver"),
    sloTargetPct: formString(formData, "sloTargetPct", "99.9"),
    paused: formBool(formData, "paused"),
    channelIds: formStrings(formData, "channelIds"),
    escalationPolicyId: formString(formData, "escalationPolicyId"),
    tags: formString(formData, "tags"),
  };

  return monitorFormSchema.safeParse(raw);
}

function fieldErrorsOf(
  error: import("zod").ZodError,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Replace a monitor's channel attachments. */
function setChannels(monitorId: string, channelIds: string[]): void {
  db.delete(monitorChannels)
    .where(eq(monitorChannels.monitorId, monitorId))
    .run();
  for (const channelId of channelIds) {
    db.insert(monitorChannels)
      .values({ monitorId, channelId })
      // Tolerate a stale channel id from a form submitted before it was deleted.
      .onConflictDoNothing()
      .run();
  }
}

export async function createMonitorAction(
  _prev: MonitorActionState,
  formData: FormData,
): Promise<MonitorActionState> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) {
    return { error: "Check the highlighted fields", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const v = parsed.data;

  let headersJson: string | null = null;
  if (v.headers) {
    const headers = parseHeaderLines(v.headers);
    if (!headers.ok) {
      return { error: headers.error, fieldErrors: { headers: headers.error } };
    }
    headersJson = JSON.stringify(headers.value);
  }

  const created = db
    .insert(monitors)
    .values({
      name: v.name,
      description: v.description || null,
      kind: v.kind,
      target: v.target ?? "",
      method: v.method,
      headers: headersJson,
      body: v.body || null,
      expectedStatus: v.expectedStatus,
      keyword: v.keyword || null,
      keywordMode: v.keywordMode,
      followRedirects: v.followRedirects,
      verifyTls: v.verifyTls,
      intervalSec: v.intervalSec,
      timeoutMs: v.timeoutMs,
      confirmFailures: v.confirmFailures,
      confirmRecoveries: v.confirmRecoveries,
      degradedMs: v.degradedMs,
      graceSec: v.graceSec,
      sslWarnDays: v.sslWarnDays,
      dnsRecordType: v.dnsRecordType,
      dnsExpected: v.dnsExpected || null,
      dnsMatchMode: v.dnsMatchMode,
      dnsResolver: v.dnsResolver || null,
      sloTargetPct: v.sloTargetPct,
      escalationPolicyId: v.escalationPolicyId || null,
      paused: v.paused,
      tags: serialiseTags(parseTags(v.tags)),
      // Minted here, not in the form, so the token never round-trips through the
      // browser before it exists.
      heartbeatToken: v.kind === "heartbeat" ? newHeartbeatToken() : null,
      createdBy: user.id,
    })
    .returning({ id: monitors.id })
    .get();

  setChannels(created.id, v.channelIds);

  // Probe immediately rather than waiting up to a full interval — a monitor that
  // sits "pending" for six hours after creation looks broken.
  if (!v.paused && v.kind !== "heartbeat") {
    void checkNow(created.id).catch(() => {});
  }

  revalidatePath("/monitors");
  revalidatePath("/dashboard");
  redirect(`/monitors/${created.id}`);
}

export async function updateMonitorAction(
  _prev: MonitorActionState,
  formData: FormData,
): Promise<MonitorActionState> {
  await requireUser();
  const id = formString(formData, "id");
  if (!id) return { error: "Missing monitor id" };

  const existing = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!existing) return { error: "That monitor no longer exists" };

  const parsed = readForm(formData);
  if (!parsed.success) {
    return { error: "Check the highlighted fields", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const v = parsed.data;

  let headersJson: string | null = null;
  if (v.headers) {
    const headers = parseHeaderLines(v.headers);
    if (!headers.ok) {
      return { error: headers.error, fieldErrors: { headers: headers.error } };
    }
    headersJson = JSON.stringify(headers.value);
  }

  db.update(monitors)
    .set({
      name: v.name,
      description: v.description || null,
      kind: v.kind,
      target: v.target ?? "",
      method: v.method,
      headers: headersJson,
      body: v.body || null,
      expectedStatus: v.expectedStatus,
      keyword: v.keyword || null,
      keywordMode: v.keywordMode,
      followRedirects: v.followRedirects,
      verifyTls: v.verifyTls,
      intervalSec: v.intervalSec,
      timeoutMs: v.timeoutMs,
      confirmFailures: v.confirmFailures,
      confirmRecoveries: v.confirmRecoveries,
      degradedMs: v.degradedMs,
      graceSec: v.graceSec,
      sslWarnDays: v.sslWarnDays,
      dnsRecordType: v.dnsRecordType,
      dnsExpected: v.dnsExpected || null,
      dnsMatchMode: v.dnsMatchMode,
      dnsResolver: v.dnsResolver || null,
      sloTargetPct: v.sloTargetPct,
      escalationPolicyId: v.escalationPolicyId || null,
      paused: v.paused,
      tags: serialiseTags(parseTags(v.tags)),
      // Converting an existing monitor to a heartbeat needs a token; converting
      // away from one keeps it, so switching back does not invalidate a URL that
      // is already deployed in someone's crontab.
      heartbeatToken:
        v.kind === "heartbeat"
          ? (existing.heartbeatToken ?? newHeartbeatToken())
          : existing.heartbeatToken,
      updatedAt: new Date(),
      // Re-run on the new cadence immediately instead of honouring a reservation
      // made under the old interval.
      nextRunAt: null,
    })
    .where(eq(monitors.id, id))
    .run();

  setChannels(id, v.channelIds);

  revalidatePath(`/monitors/${id}`);
  revalidatePath("/monitors");
  revalidatePath("/dashboard");
  redirect(`/monitors/${id}`);
}

export async function togglePauseAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = formString(formData, "id");
  const monitor = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!monitor) return;

  db.update(monitors)
    .set({
      paused: !monitor.paused,
      // Resuming should probe promptly, and the counters from before the pause are
      // stale — the world moved on while nobody was looking.
      nextRunAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    })
    .where(eq(monitors.id, id))
    .run();

  revalidatePath(`/monitors/${id}`);
  revalidatePath("/monitors");
  revalidatePath("/dashboard");
}

export async function checkNowAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = formString(formData, "id");
  if (!id) return;

  // "Check now" bypasses the interval, so without a cap a held-down button becomes
  // a way to hammer someone else's endpoint from your server.
  if (!rateLimit(`checknow:${id}`, 10, 60_000).ok) return;

  await checkNow(id);
  revalidatePath(`/monitors/${id}`);
  revalidatePath("/dashboard");
}

/**
 * Deletion cascades to every check, rollup, and incident for this monitor, so it is
 * irreversible loss of history rather than a config change. Admins only — a role that
 * gates nothing is worse than no roles at all, because "member" reads as restricted.
 */
export async function deleteMonitorAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  // Checks, rollups, incidents, and channel links all cascade from the schema.
  if (id) db.delete(monitors).where(eq(monitors.id, id)).run();
  revalidatePath("/monitors");
  revalidatePath("/dashboard");
  redirect("/monitors");
}

/** Rotating invalidates a URL that is already deployed in someone's crontab. */
export async function rotateHeartbeatTokenAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  const monitor = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!monitor || monitor.kind !== "heartbeat") return;

  db.update(monitors)
    .set({ heartbeatToken: newHeartbeatToken() })
    .where(eq(monitors.id, id))
    .run();

  revalidatePath(`/monitors/${id}`);
}

/** Rebuild every rollup bucket for a monitor, for when aggregates look wrong. */
export async function rebuildRollupsAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = formString(formData, "id");
  if (id) rollupMonitorFully(id);
  revalidatePath(`/monitors/${id}`);
}
