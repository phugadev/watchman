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

export interface MonitorActionState {
  error?: string;
  /** Field-level errors, keyed by form field name. */
  fieldErrors?: Record<string, string>;
}

/** Translate a FormData submission into validated values. */
function readForm(formData: FormData) {
  const raw = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    kind: String(formData.get("kind") ?? "http"),
    target: String(formData.get("target") ?? ""),
    method: String(formData.get("method") ?? "GET"),
    headers: String(formData.get("headers") ?? ""),
    body: String(formData.get("body") ?? ""),
    expectedStatus: String(formData.get("expectedStatus") ?? "2xx"),
    keyword: String(formData.get("keyword") ?? ""),
    keywordMode: String(formData.get("keywordMode") ?? "contains"),
    followRedirects: formData.get("followRedirects") === "on",
    verifyTls: formData.get("verifyTls") === "on",
    intervalSec: String(formData.get("intervalSec") ?? "60"),
    timeoutMs: String(formData.get("timeoutMs") ?? "10000"),
    confirmFailures: String(formData.get("confirmFailures") ?? "2"),
    confirmRecoveries: String(formData.get("confirmRecoveries") ?? "2"),
    // An empty degraded field means "no threshold", which is not the same as 0.
    degradedMs: formData.get("degradedMs")
      ? String(formData.get("degradedMs"))
      : null,
    graceSec: String(formData.get("graceSec") ?? "120"),
    sslWarnDays: String(formData.get("sslWarnDays") ?? "21"),
    sloTargetPct: String(formData.get("sloTargetPct") ?? "99.9"),
    paused: formData.get("paused") === "on",
    channelIds: formData.getAll("channelIds").map(String),
    tags: String(formData.get("tags") ?? ""),
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
      sloTargetPct: v.sloTargetPct,
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
  const id = String(formData.get("id") ?? "");
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
      sloTargetPct: v.sloTargetPct,
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
  const id = String(formData.get("id") ?? "");
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
  const id = String(formData.get("id") ?? "");
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
  const id = String(formData.get("id") ?? "");
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
  const id = String(formData.get("id") ?? "");
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
  const id = String(formData.get("id") ?? "");
  if (id) rollupMonitorFully(id);
  revalidatePath(`/monitors/${id}`);
}
