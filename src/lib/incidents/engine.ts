import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  checks,
  incidentEvents,
  incidents,
  maintenanceMonitors,
  maintenanceWindows,
  monitors,
  type Monitor,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { publish } from "@/lib/events/bus";
import { computeGrade } from "@/lib/metrics/grade";
import { summarize } from "@/lib/metrics/uptime";
import { notifyMonitor, type AlertPayload } from "@/lib/notify";
import type { ProbeResult } from "@/lib/probe/types";
import { FLAP_WINDOW_MS, decide } from "./state-machine";

/**
 * Is this monitor inside a maintenance window right now?
 *
 * `suppressAlerts` withholds notifications while still recording checks — the
 * usual choice, because you want the data in the timeline afterwards even though
 * nobody should be paged for a planned deploy.
 */
export function maintenanceState(
  monitorId: string,
  now = new Date(),
): { suppressAlerts: boolean; pauseChecks: boolean; title?: string } {
  const row = db
    .select({
      suppressAlerts: maintenanceWindows.suppressAlerts,
      pauseChecks: maintenanceWindows.pauseChecks,
      title: maintenanceWindows.title,
    })
    .from(maintenanceMonitors)
    .innerJoin(
      maintenanceWindows,
      eq(maintenanceWindows.id, maintenanceMonitors.windowId),
    )
    .where(
      and(
        eq(maintenanceMonitors.monitorId, monitorId),
        lte(maintenanceWindows.startsAt, now),
        gte(maintenanceWindows.endsAt, now),
      ),
    )
    .get();

  return {
    suppressAlerts: row?.suppressAlerts ?? false,
    pauseChecks: row?.pauseChecks ?? false,
    title: row?.title,
  };
}

/** Rolling 24h health, attached to alerts so they carry context. */
function health(monitorId: string) {
  const rows = db
    .select({ ok: checks.ok, latencyMs: checks.latencyMs })
    .from(checks)
    .where(
      and(
        eq(checks.monitorId, monitorId),
        gte(checks.at, new Date(Date.now() - 86_400_000)),
      ),
    )
    .all();

  const summary = summarize(rows);
  const incidentCount = db
    .select({ n: sql<number>`count(*)` })
    .from(incidents)
    .where(
      and(
        eq(incidents.monitorId, monitorId),
        gte(incidents.startedAt, new Date(Date.now() - 30 * 86_400_000)),
      ),
    )
    .get();

  const graded = computeGrade({
    uptimePct: summary.uptimePct,
    p95Ms: summary.p95Ms,
    incidentsPer30d: incidentCount?.n ?? 0,
  });

  return { summary, grade: graded.grade };
}

function buildPayload({
  monitor,
  event,
  result,
  incident,
}: {
  monitor: Monitor;
  event: AlertPayload["event"];
  result?: ProbeResult;
  incident?: {
    id: string;
    startedAt: Date;
    resolvedAt?: Date | null;
    cause?: string | null;
    flapping?: boolean;
  };
}): AlertPayload {
  const h = health(monitor.id);
  return {
    version: 1,
    event,
    timestamp: new Date().toISOString(),
    monitor: {
      id: monitor.id,
      name: monitor.name,
      kind: monitor.kind,
      target: monitor.target,
      url: `${env.publicUrl}/monitors/${monitor.id}`,
    },
    incident: incident
      ? {
          id: incident.id,
          startedAt: incident.startedAt.toISOString(),
          resolvedAt: incident.resolvedAt?.toISOString() ?? null,
          durationMs: incident.resolvedAt
            ? incident.resolvedAt.getTime() - incident.startedAt.getTime()
            : null,
          cause: incident.cause ?? null,
          flapping: incident.flapping ?? false,
          url: `${env.publicUrl}/incidents/${incident.id}`,
        }
      : undefined,
    check: result
      ? {
          status: result.status,
          latencyMs: result.latencyMs,
          httpStatus: result.httpStatus ?? null,
          error: result.error ?? null,
        }
      : undefined,
    health: {
      grade: h.grade,
      uptime24hPct: Number(h.summary.uptimePct.toFixed(4)),
      p95Ms: h.summary.p95Ms,
    },
  };
}

/**
 * Persist a check result and run the incident state machine over it.
 *
 * The database writes happen in one transaction so a crash mid-way cannot leave a
 * monitor marked down with no incident (or the reverse). Notifications are sent
 * *after* the transaction commits: holding a SQLite write lock open across a
 * network call to Telegram would block every other probe for the duration.
 */
export async function recordCheck(
  monitor: Monitor,
  result: ProbeResult,
): Promise<void> {
  const now = new Date();
  const maintenance = maintenanceState(monitor.id, now);

  const open = db
    .select()
    .from(incidents)
    .where(and(eq(incidents.monitorId, monitor.id), ne(incidents.status, "resolved")))
    .orderBy(desc(incidents.startedAt))
    .get();

  const recentCount = db
    .select({ n: sql<number>`count(*)` })
    .from(incidents)
    .where(
      and(
        eq(incidents.monitorId, monitor.id),
        gte(incidents.startedAt, new Date(now.getTime() - FLAP_WINDOW_MS)),
      ),
    )
    .get();

  const outcome = decide({
    result: { status: result.status, error: result.error },
    state: {
      lastStatus: monitor.lastStatus,
      consecutiveFailures: monitor.consecutiveFailures,
      consecutiveSuccesses: monitor.consecutiveSuccesses,
      hasOpenIncident: Boolean(open),
      flapping: open?.flapping ?? false,
    },
    policy: {
      confirmFailures: monitor.confirmFailures,
      confirmRecoveries: monitor.confirmRecoveries,
    },
    recentIncidents: recentCount?.n ?? 0,
  });

  // Queued inside the transaction, dispatched after it commits.
  const pending: Array<() => Promise<void>> = [];

  /*
   * `mark_flapping` is only ever emitted alongside `open_incident`, so there is no
   * existing row to update — it is a property of the incident about to be
   * created. Resolving it up front keeps the effect loop from depending on the
   * order the two effects arrive in.
   */
  const isFlapping = outcome.effects.some((e) => e.type === "mark_flapping");

  db.transaction((tx) => {
    tx.insert(checks)
      .values({
        monitorId: monitor.id,
        at: now,
        ok: result.ok,
        status: result.status,
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus ?? null,
        error: result.error ?? null,
        meta: result.meta ? JSON.stringify(result.meta) : null,
      })
      .run();

    tx.update(monitors)
      .set({
        lastStatus: outcome.status,
        lastCheckedAt: now,
        lastLatencyMs: result.latencyMs,
        lastError: result.error ?? null,
        consecutiveFailures: outcome.consecutiveFailures,
        consecutiveSuccesses: outcome.consecutiveSuccesses,
        ...(outcome.changed ? { lastStatusChangedAt: now } : {}),
      })
      .where(eq(monitors.id, monitor.id))
      .run();

    for (const effect of outcome.effects) {
      switch (effect.type) {
        case "mark_flapping":
          // Consumed as `isFlapping` above; nothing to write on its own.
          break;

        case "open_incident": {
          const created = tx
            .insert(incidents)
            .values({
              monitorId: monitor.id,
              status: "open",
              startedAt: now,
              cause: effect.cause,
              failedChecks: effect.failedChecks,
              suppressed: maintenance.suppressAlerts,
              flapping: isFlapping,
            })
            .returning()
            .get();

          tx.insert(incidentEvents)
            .values({
              incidentId: created.id,
              at: now,
              kind: "opened",
              message:
                effect.cause ??
                `${effect.failedChecks} consecutive failed checks`,
              meta: JSON.stringify({ failedChecks: effect.failedChecks }),
            })
            .run();

          if (maintenance.suppressAlerts) {
            tx.insert(incidentEvents)
              .values({
                incidentId: created.id,
                at: now,
                kind: "suppressed",
                message: `Alerts suppressed by maintenance window "${maintenance.title}"`,
              })
              .run();
          }

          publish({
            type: "incident_opened",
            at: now.getTime(),
            monitorId: monitor.id,
            monitorName: monitor.name,
            incidentId: created.id,
            cause: effect.cause,
          });

          // A flapping monitor still gets an incident row — the history matters —
          // but it does not page anyone. Twenty alerts an hour from one unstable
          // endpoint trains people to mute the channel, which costs more than the
          // alerts are worth.
          if (!maintenance.suppressAlerts && !isFlapping) {
            pending.push(async () => {
              await notifyMonitor({
                monitorId: monitor.id,
                incidentId: created.id,
                kind: "opened",
                payload: buildPayload({
                  monitor,
                  event: "monitor.down",
                  result,
                  incident: {
                    id: created.id,
                    startedAt: now,
                    cause: effect.cause,
                    flapping: created.flapping,
                  },
                }),
              });
            });
          }
          break;
        }

        case "resolve_incident": {
          if (!open) break;
          const durationMs = now.getTime() - open.startedAt.getTime();

          tx.update(incidents)
            .set({ status: "resolved", resolvedAt: now })
            .where(eq(incidents.id, open.id))
            .run();

          tx.insert(incidentEvents)
            .values({
              incidentId: open.id,
              at: now,
              kind: "resolved",
              message: `Recovered after ${Math.round(durationMs / 1000)}s`,
              meta: JSON.stringify({ durationMs }),
            })
            .run();

          publish({
            type: "incident_resolved",
            at: now.getTime(),
            monitorId: monitor.id,
            monitorName: monitor.name,
            incidentId: open.id,
            durationMs,
          });

          // A recovery is announced even when the outage itself was suppressed:
          // if the incident was visible on a status page, its resolution must be
          // too. Flapping monitors stay silent, since the point of the flag is to
          // stop the open/close churn from paging anyone.
          if (!open.flapping) {
            pending.push(async () => {
              await notifyMonitor({
                monitorId: monitor.id,
                incidentId: open.id,
                kind: "resolved",
                payload: buildPayload({
                  monitor,
                  event: "monitor.up",
                  result,
                  incident: {
                    id: open.id,
                    startedAt: open.startedAt,
                    resolvedAt: now,
                    cause: open.cause,
                  },
                }),
              });
            });
          }
          break;
        }

        case "notify_degraded": {
          if (maintenance.suppressAlerts) break;
          pending.push(async () => {
            await notifyMonitor({
              monitorId: monitor.id,
              kind: "degraded",
              payload: buildPayload({ monitor, event: "monitor.degraded", result }),
            });
          });
          break;
        }
      }
    }
  });

  publish({
    type: "check",
    at: now.getTime(),
    monitorId: monitor.id,
    monitorName: monitor.name,
    status: result.status,
    latencyMs: result.latencyMs,
    error: result.error ?? null,
    changed: outcome.changed,
  });

  // Deliveries run concurrently and never reject into the scheduler tick — a
  // Telegram outage must not stop the next check from running.
  await Promise.allSettled(pending.map((fn) => fn()));
}

/** Acknowledge an open incident, silencing it without claiming it is fixed. */
export function acknowledgeIncident(
  incidentId: string,
  userId: string,
  userName: string,
): void {
  const now = new Date();
  const incident = db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), isNull(incidents.acknowledgedAt)))
    .get();

  if (!incident || incident.status === "resolved") return;

  db.transaction((tx) => {
    tx.update(incidents)
      .set({ status: "acknowledged", acknowledgedAt: now, acknowledgedBy: userId })
      .where(eq(incidents.id, incidentId))
      .run();

    tx.insert(incidentEvents)
      .values({
        incidentId,
        at: now,
        kind: "acknowledged",
        message: `Acknowledged by ${userName}`,
        actorId: userId,
      })
      .run();
  });

  const monitor = db
    .select({ name: monitors.name })
    .from(monitors)
    .where(eq(monitors.id, incident.monitorId))
    .get();

  publish({
    type: "incident_acknowledged",
    at: now.getTime(),
    monitorId: incident.monitorId,
    monitorName: monitor?.name ?? "unknown",
    incidentId,
    by: userName,
  });
}

/** Free-text note on an incident's timeline. */
export function commentOnIncident(
  incidentId: string,
  userId: string,
  message: string,
): void {
  const trimmed = message.trim().slice(0, 2000);
  if (!trimmed) return;
  db.insert(incidentEvents)
    .values({ incidentId, kind: "comment", message: trimmed, actorId: userId })
    .run();
}

/** Close an incident by hand, for outages that resolved outside Watchman's view. */
export function resolveIncidentManually(
  incidentId: string,
  userId: string,
  userName: string,
): void {
  const now = new Date();
  const incident = db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), ne(incidents.status, "resolved")))
    .get();
  if (!incident) return;

  db.transaction((tx) => {
    tx.update(incidents)
      .set({ status: "resolved", resolvedAt: now })
      .where(eq(incidents.id, incidentId))
      .run();
    tx.insert(incidentEvents)
      .values({
        incidentId,
        at: now,
        kind: "resolved",
        message: `Manually resolved by ${userName}`,
        actorId: userId,
      })
      .run();
  });
}

/** Bulk acknowledge, for the dashboard's "ack all" during a wide outage. */
export function acknowledgeAll(
  incidentIds: string[],
  userId: string,
  userName: string,
): void {
  if (incidentIds.length === 0) return;
  const open = db
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(inArray(incidents.id, incidentIds), ne(incidents.status, "resolved")))
    .all();
  for (const row of open) acknowledgeIncident(row.id, userId, userName);
}
