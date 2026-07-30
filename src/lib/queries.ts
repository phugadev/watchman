import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  channels,
  checks,
  incidentEvents,
  incidents,
  invites,
  maintenanceMonitors,
  maintenanceWindows,
  monitorChannels,
  monitors,
  notifications,
  rollups,
  statusPageItems,
  statusPages,
  users,
  type Monitor,
} from "@/lib/db/schema";
import { maintenancePhase } from "@/lib/maintenance/phase";
import { GRADE_CUTOFFS, computeGrade, type Grade } from "@/lib/metrics/grade";
import {
  WINDOWS,
  asBucket,
  mergeBuckets,
  sloBudget,
  summarize,
  type BucketLike,
  type MonitorStatus,
  type Summary,
  type WindowKey,
} from "@/lib/metrics/uptime";
import { DAY_MS, HOUR_MS, bucketStart } from "@/lib/scheduler/rollup";

/** A monitor plus everything the dashboard renders next to it. */
export interface MonitorHealth {
  monitor: Monitor;
  /** Effective status: paused overrides whatever the last check said. */
  status: MonitorStatus;
  summary24h: Summary;
  grade: Grade;
  gradeScore: number;
  incidents30d: number;
  openIncidentId: string | null;
  /** Newest last, for the compact sparkline tape. */
  tape: { status: MonitorStatus; at: number; latencyMs: number | null }[];
}

/** Paused monitors report "paused" regardless of their last recorded check. */
function effectiveStatus(m: Monitor): MonitorStatus {
  if (m.paused) return "paused";
  if (!m.lastCheckedAt) return "pending";
  return m.lastStatus;
}

/**
 * Load every monitor with its rolling health.
 *
 * Written as a handful of set-based queries rather than a loop of per-monitor
 * lookups: a fleet of forty monitors would otherwise issue 160 queries per
 * dashboard render.
 */
export function listMonitorsWithHealth(tapeSize = 40): MonitorHealth[] {
  const all = db.select().from(monitors).orderBy(monitors.name).all();
  if (all.length === 0) return [];

  const ids = all.map((m) => m.id);
  const now = Date.now();
  const since30d = new Date(now - WINDOWS["30d"]);

  /*
   * The window is aligned to hour boundaries: the 23 most recent closed hours, plus the
   * current partial one.
   *
   * A naive `now - 24h` lower bound silently loses data. Buckets are hour-aligned, so
   * the bucket *containing* that instant starts before it and gets filtered out, dropping
   * up to 59 minutes — which showed up as a 1.4-point uptime discrepancy against an exact
   * scan. Aligning both bounds to the grid means the pieces tile exactly: no gap, no
   * double count, and availability comes out identical to counting raw rows.
   */
  const currentHourStart = new Date(bucketStart(now, "hour"));
  const windowStart = new Date(currentHourStart.getTime() - 23 * HOUR_MS);

  /*
   * 24h health is assembled from closed hourly rollups plus raw checks for the current
   * partial hour, rather than every raw check in the window.
   *
   * The old approach loaded the entire 24h of checks for every monitor on each render:
   * ~1,440 rows per monitor per day, so a forty-monitor fleet meant ~58,000 rows on a
   * page that is `force-dynamic` and therefore never cached. This is ~23 rollup rows
   * plus one partial hour per monitor, so cost stops scaling with the check interval.
   */
  const closedBuckets = db
    .select({
      monitorId: rollups.monitorId,
      total: rollups.total,
      upCount: rollups.upCount,
      degradedCount: rollups.degradedCount,
      downCount: rollups.downCount,
      avgMs: rollups.avgMs,
      p95Ms: rollups.p95Ms,
      minMs: rollups.minMs,
      maxMs: rollups.maxMs,
    })
    .from(rollups)
    .where(
      and(
        inArray(rollups.monitorId, ids),
        eq(rollups.bucket, "hour"),
        gte(rollups.startedAt, windowStart),
        lt(rollups.startedAt, currentHourStart),
      ),
    )
    .all();

  const currentHourChecks = db
    .select({
      monitorId: checks.monitorId,
      ok: checks.ok,
      latencyMs: checks.latencyMs,
    })
    .from(checks)
    .where(
      and(inArray(checks.monitorId, ids), gte(checks.at, currentHourStart)),
    )
    .all();

  /*
   * The tape wants the last N checks per monitor, which a plain time filter cannot
   * express: N checks is 40 minutes for a 60-second monitor and 10 days for a 6-hourly
   * one. A window function gets exactly N per monitor in a single round trip, instead of
   * one LIMIT query per monitor.
   */
  const tapeRows = db.all<{
    monitor_id: string;
    at: number;
    status: string;
    latency_ms: number | null;
  }>(sql`
    SELECT monitor_id, at, status, latency_ms FROM (
      SELECT
        monitor_id,
        at,
        status,
        latency_ms,
        ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY at DESC) AS rn
      FROM checks
      WHERE monitor_id IN ${ids}
    )
    WHERE rn <= ${Math.max(0, tapeSize)}
    ORDER BY monitor_id, at ASC
  `);

  const incidentCounts = db
    .select({ monitorId: incidents.monitorId, n: sql<number>`count(*)` })
    .from(incidents)
    .where(
      and(inArray(incidents.monitorId, ids), gte(incidents.startedAt, since30d)),
    )
    .groupBy(incidents.monitorId)
    .all();

  const openIncidents = db
    .select({ monitorId: incidents.monitorId, id: incidents.id })
    .from(incidents)
    .where(and(inArray(incidents.monitorId, ids), ne(incidents.status, "resolved")))
    .all();

  const bucketsByMonitor = new Map<string, BucketLike[]>();
  for (const b of closedBuckets) {
    const list = bucketsByMonitor.get(b.monitorId);
    if (list) list.push(b);
    else bucketsByMonitor.set(b.monitorId, [b]);
  }

  const currentByMonitor = new Map<string, { ok: boolean; latencyMs: number | null }[]>();
  for (const c of currentHourChecks) {
    const list = currentByMonitor.get(c.monitorId);
    if (list) list.push(c);
    else currentByMonitor.set(c.monitorId, [c]);
  }

  const tapeByMonitor = new Map<string, MonitorHealth["tape"]>();
  for (const r of tapeRows) {
    const entry = {
      status: r.status as MonitorStatus,
      at: r.at,
      latencyMs: r.latency_ms,
    };
    const list = tapeByMonitor.get(r.monitor_id);
    if (list) list.push(entry);
    else tapeByMonitor.set(r.monitor_id, [entry]);
  }

  const incidentMap = new Map(incidentCounts.map((r) => [r.monitorId, r.n]));
  const openMap = new Map(openIncidents.map((r) => [r.monitorId, r.id]));

  return all.map((monitor) => {
    const closed = bucketsByMonitor.get(monitor.id) ?? [];
    const partial = currentByMonitor.get(monitor.id) ?? [];

    const summary24h = mergeBuckets([
      ...closed,
      // The current hour has no rollup yet, so fold its raw checks in as one bucket.
      ...(partial.length > 0 ? [asBucket(partial, monitor.degradedMs)] : []),
    ]);

    const incidents30d = incidentMap.get(monitor.id) ?? 0;
    const graded = computeGrade({
      uptimePct: summary24h.uptimePct,
      p95Ms: summary24h.p95Ms,
      incidentsPer30d: incidents30d,
    });

    return {
      monitor,
      status: effectiveStatus(monitor),
      summary24h,
      // A monitor with no data yet has nothing to grade; showing F would libel a
      // check that has simply not run.
      grade: summary24h.total === 0 ? ("S" as Grade) : graded.grade,
      gradeScore: graded.score,
      incidents30d,
      openIncidentId: openMap.get(monitor.id) ?? null,
      // Already ordered oldest-to-newest by the window query.
      tape: tapeByMonitor.get(monitor.id) ?? [],
    };
  });
}

export function getMonitor(id: string): Monitor | undefined {
  return db.select().from(monitors).where(eq(monitors.id, id)).get();
}

/** Everything the monitor detail page needs for one time window. */
export function getMonitorDetail(id: string, windowKey: WindowKey = "24h") {
  const monitor = getMonitor(id);
  if (!monitor) return null;

  const windowMs = WINDOWS[windowKey];
  const since = new Date(Date.now() - windowMs);

  /*
   * Short windows read raw checks for full fidelity; long ones read hourly
   * rollups. Plotting 30 days of 60-second checks would mean 43k points behind a
   * ~900px chart — indistinguishable from the aggregate, but hundreds of times the
   * query and payload cost.
   */
  const useRollups = windowMs > WINDOWS["24h"];

  const series = useRollups
    ? db
        .select({
          at: rollups.startedAt,
          avgMs: rollups.avgMs,
          p95Ms: rollups.p95Ms,
          minMs: rollups.minMs,
          maxMs: rollups.maxMs,
          upCount: rollups.upCount,
          degradedCount: rollups.degradedCount,
          downCount: rollups.downCount,
          total: rollups.total,
        })
        .from(rollups)
        .where(
          and(
            eq(rollups.monitorId, id),
            eq(rollups.bucket, "hour"),
            gte(rollups.startedAt, since),
          ),
        )
        .orderBy(rollups.startedAt)
        .all()
        .map((r) => ({
          at: r.at.getTime(),
          latencyMs: r.p95Ms ?? r.avgMs ?? null,
          minMs: r.minMs,
          maxMs: r.maxMs,
          status: (r.downCount > 0
            ? "down"
            : r.degradedCount > 0
              ? "degraded"
              : "up") as MonitorStatus,
          total: r.total,
        }))
    : db
        .select({
          at: checks.at,
          latencyMs: checks.latencyMs,
          status: checks.status,
        })
        .from(checks)
        .where(and(eq(checks.monitorId, id), gte(checks.at, since)))
        .orderBy(checks.at)
        .all()
        .map((r) => ({
          at: r.at.getTime(),
          latencyMs: r.latencyMs,
          minMs: null,
          maxMs: null,
          status: r.status as MonitorStatus,
          total: 1,
        }));

  const raw = db
    .select({ ok: checks.ok, latencyMs: checks.latencyMs })
    .from(checks)
    .where(and(eq(checks.monitorId, id), gte(checks.at, since)))
    .all();

  const summary = summarize(raw, monitor.degradedMs);

  const incidents30d =
    db
      .select({ n: sql<number>`count(*)` })
      .from(incidents)
      .where(
        and(
          eq(incidents.monitorId, id),
          gte(incidents.startedAt, new Date(Date.now() - WINDOWS["30d"])),
        ),
      )
      .get()?.n ?? 0;

  const graded = computeGrade({
    uptimePct: summary.uptimePct,
    p95Ms: summary.p95Ms,
    incidentsPer30d: incidents30d,
  });

  const recentChecks = db
    .select()
    .from(checks)
    .where(eq(checks.monitorId, id))
    .orderBy(desc(checks.at))
    .limit(50)
    .all();

  const monitorIncidents = db
    .select()
    .from(incidents)
    .where(eq(incidents.monitorId, id))
    .orderBy(desc(incidents.startedAt))
    .limit(20)
    .all();

  const attachedChannels = db
    .select({ channel: channels })
    .from(monitorChannels)
    .innerJoin(channels, eq(channels.id, monitorChannels.channelId))
    .where(eq(monitorChannels.monitorId, id))
    .all()
    .map((r) => r.channel);

  return {
    monitor,
    status: effectiveStatus(monitor),
    windowKey,
    series,
    summary,
    grade: graded.grade,
    gradeScore: graded.score,
    gradeParts: graded.parts,
    incidents30d,
    budget: sloBudget({
      uptimePct: summary.uptimePct,
      targetPct: monitor.sloTargetPct,
      windowMs,
    }),
    recentChecks,
    incidents: monitorIncidents,
    channels: attachedChannels,
    dailyTape: dailyTape(id, 90),
  };
}

/**
 * Daily uptime buckets for the status-page tape.
 *
 * Days with no data render as "pending" rather than "up". Claiming a monitor was
 * operational on a day it did not exist would be a quiet lie on a public page.
 */
export function dailyTape(
  monitorId: string,
  days: number,
): { day: number; status: MonitorStatus; uptimePct: number | null; total: number }[] {
  const start = bucketStart(Date.now(), "day") - (days - 1) * DAY_MS;

  const rows = db
    .select({
      startedAt: rollups.startedAt,
      upCount: rollups.upCount,
      degradedCount: rollups.degradedCount,
      downCount: rollups.downCount,
      total: rollups.total,
    })
    .from(rollups)
    .where(
      and(
        eq(rollups.monitorId, monitorId),
        eq(rollups.bucket, "day"),
        gte(rollups.startedAt, new Date(start)),
      ),
    )
    .all();

  const byDay = new Map(rows.map((r) => [bucketStart(r.startedAt.getTime(), "day"), r]));

  const out: {
    day: number;
    status: MonitorStatus;
    uptimePct: number | null;
    total: number;
  }[] = [];

  for (let i = 0; i < days; i++) {
    const day = start + i * DAY_MS;
    const r = byDay.get(day);
    if (!r || r.total === 0) {
      out.push({ day, status: "pending", uptimePct: null, total: 0 });
      continue;
    }
    const uptimePct = ((r.upCount + r.degradedCount) / r.total) * 100;
    out.push({
      day,
      status: r.downCount > 0 ? "down" : r.degradedCount > 0 ? "degraded" : "up",
      uptimePct,
      total: r.total,
    });
  }

  return out;
}

/* ---------------------------------------------------------------------------
 * Incidents
 * ------------------------------------------------------------------------- */

export function listIncidents({
  status = "all",
  limit = 100,
}: { status?: "all" | "open" | "resolved"; limit?: number } = {}) {
  const where =
    status === "open"
      ? ne(incidents.status, "resolved")
      : status === "resolved"
        ? eq(incidents.status, "resolved")
        : undefined;

  return db
    .select({
      incident: incidents,
      monitorName: monitors.name,
      monitorKind: monitors.kind,
    })
    .from(incidents)
    .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(where)
    .orderBy(desc(incidents.startedAt))
    .limit(limit)
    .all();
}

export function getIncident(id: string) {
  const row = db
    .select({ incident: incidents, monitor: monitors })
    .from(incidents)
    .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(eq(incidents.id, id))
    .get();

  if (!row) return null;

  const timeline = db
    .select({
      event: incidentEvents,
      actorName: users.name,
    })
    .from(incidentEvents)
    .leftJoin(users, eq(users.id, incidentEvents.actorId))
    .where(eq(incidentEvents.incidentId, id))
    .orderBy(incidentEvents.at)
    .all();

  const deliveries = db
    .select({ notification: notifications, channelName: channels.name })
    .from(notifications)
    .innerJoin(channels, eq(channels.id, notifications.channelId))
    .where(eq(notifications.incidentId, id))
    .orderBy(notifications.at)
    .all();

  // The checks bracketing the incident, which is what someone reading the
  // timeline actually wants to see.
  const window = db
    .select()
    .from(checks)
    .where(
      and(
        eq(checks.monitorId, row.monitor.id),
        gte(checks.at, new Date(row.incident.startedAt.getTime() - 300_000)),
      ),
    )
    .orderBy(checks.at)
    .limit(60)
    .all();

  return { ...row, timeline, deliveries, checks: window };
}

export function countOpenIncidents(): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(incidents)
      .where(ne(incidents.status, "resolved"))
      .get()?.n ?? 0
  );
}

/* ---------------------------------------------------------------------------
 * Fleet-wide summary for the dashboard hero
 * ------------------------------------------------------------------------- */

export interface FleetSummary {
  total: number;
  up: number;
  degraded: number;
  down: number;
  paused: number;
  pending: number;
  openIncidents: number;
  /** Availability-weighted mean across all active monitors. */
  uptime24hPct: number;
  worstGrade: Grade;
  overallGrade: Grade;
  overallScore: number;
  slowestP95: { name: string; p95Ms: number } | null;
}

const GRADE_ORDER: Grade[] = ["S", "A", "B", "C", "D", "F"];

export function fleetSummary(health: MonitorHealth[]): FleetSummary {
  const active = health.filter((h) => h.status !== "paused");

  const counts = { up: 0, degraded: 0, down: 0, paused: 0, pending: 0 };
  for (const h of health) counts[h.status]++;

  const withData = active.filter((h) => h.summary24h.total > 0);
  const uptime24hPct =
    withData.length === 0
      ? 100
      : withData.reduce((a, h) => a + h.summary24h.uptimePct, 0) / withData.length;

  // The fleet grade is the mean of member *scores*, then bucketed once. Averaging
  // the letters instead would let one F hide behind a crowd of S's.
  const overallScore =
    withData.length === 0
      ? 100
      : withData.reduce((a, h) => a + h.gradeScore, 0) / withData.length;

  const overallGrade =
    GRADE_CUTOFFS.find((c) => overallScore >= c.min)?.grade ?? "F";

  const worstGrade =
    withData.length === 0
      ? "S"
      : withData
          .map((h) => h.grade)
          .reduce((worst, g) =>
            GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(worst) ? g : worst,
          );

  const slowest = withData
    .filter((h) => h.summary24h.p95Ms !== null)
    .sort((a, b) => (b.summary24h.p95Ms ?? 0) - (a.summary24h.p95Ms ?? 0))[0];

  return {
    total: health.length,
    ...counts,
    openIncidents: countOpenIncidents(),
    uptime24hPct,
    worstGrade,
    overallGrade,
    overallScore: Math.round(overallScore * 10) / 10,
    slowestP95: slowest
      ? { name: slowest.monitor.name, p95Ms: slowest.summary24h.p95Ms! }
      : null,
  };
}

/* ---------------------------------------------------------------------------
 * Channels, status pages, team, maintenance
 * ------------------------------------------------------------------------- */

export function listChannels() {
  return db
    .select()
    .from(channels)
    .orderBy(channels.name)
    .all()
    .map((channel) => ({
      channel,
      monitorCount:
        db
          .select({ n: sql<number>`count(*)` })
          .from(monitorChannels)
          .where(eq(monitorChannels.channelId, channel.id))
          .get()?.n ?? 0,
    }));
}

export function listStatusPages() {
  return db
    .select()
    .from(statusPages)
    .orderBy(statusPages.title)
    .all()
    .map((page) => ({
      page,
      itemCount:
        db
          .select({ n: sql<number>`count(*)` })
          .from(statusPageItems)
          .where(eq(statusPageItems.pageId, page.id))
          .get()?.n ?? 0,
    }));
}

export function getStatusPageBySlug(slug: string) {
  const page = db
    .select()
    .from(statusPages)
    .where(eq(statusPages.slug, slug))
    .get();
  if (!page) return null;

  const items = db
    .select({ item: statusPageItems, monitor: monitors })
    .from(statusPageItems)
    .innerJoin(monitors, eq(monitors.id, statusPageItems.monitorId))
    .where(eq(statusPageItems.pageId, page.id))
    .orderBy(statusPageItems.sortOrder, monitors.name)
    .all();

  return { page, items };
}

export function listTeam() {
  return db.select().from(users).orderBy(users.createdAt).all();
}

export function listPendingInvites() {
  return db
    .select({ invite: invites, createdByName: users.name })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.createdBy))
    .where(isNull(invites.acceptedAt))
    .orderBy(desc(invites.createdAt))
    .all();
}

/**
 * Maintenance windows with their affected monitors and current phase.
 *
 * Phase is derived rather than stored, so it can never drift out of sync with the
 * clock — a status column would need a job to keep it honest.
 */
export function listMaintenanceWindows(now = new Date()) {
  const windows = db
    .select()
    .from(maintenanceWindows)
    .orderBy(desc(maintenanceWindows.startsAt))
    .limit(50)
    .all();

  if (windows.length === 0) return [];

  const links = db
    .select({
      windowId: maintenanceMonitors.windowId,
      monitorId: monitors.id,
      monitorName: monitors.name,
    })
    .from(maintenanceMonitors)
    .innerJoin(monitors, eq(monitors.id, maintenanceMonitors.monitorId))
    .where(
      inArray(
        maintenanceMonitors.windowId,
        windows.map((w) => w.id),
      ),
    )
    .all();

  const byWindow = new Map<string, { id: string; name: string }[]>();
  for (const l of links) {
    const list = byWindow.get(l.windowId);
    const entry = { id: l.monitorId, name: l.monitorName };
    if (list) list.push(entry);
    else byWindow.set(l.windowId, [entry]);
  }

  return windows.map((window) => ({
    window,
    monitors: byWindow.get(window.id) ?? [],
    // Shared with the engine's boundary semantics via one helper, so the badge can
    // never say "finished" while alerts are still being withheld.
    phase: maintenancePhase(window.startsAt, window.endsAt, now),
  }));
}

/** Windows suppressing or pausing anything right now, for the dashboard banner. */
export function activeMaintenanceCount(now = new Date()): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(maintenanceWindows)
      .where(
        and(
          lte(maintenanceWindows.startsAt, now),
          gte(maintenanceWindows.endsAt, now),
        ),
      )
      .get()?.n ?? 0
  );
}

export function listRecentDeliveries(limit = 50) {
  return db
    .select({
      notification: notifications,
      channelName: channels.name,
      channelKind: channels.kind,
      monitorName: monitors.name,
    })
    .from(notifications)
    .innerJoin(channels, eq(channels.id, notifications.channelId))
    .leftJoin(monitors, eq(monitors.id, notifications.monitorId))
    .orderBy(desc(notifications.at))
    .limit(limit)
    .all();
}

/** Monitors with no channel attached — an alert nobody will ever receive. */
export function monitorsWithoutChannels(): Monitor[] {
  return db
    .select({ monitor: monitors })
    .from(monitors)
    .leftJoin(monitorChannels, eq(monitorChannels.monitorId, monitors.id))
    .where(and(isNull(monitorChannels.channelId), eq(monitors.paused, false)))
    .all()
    .map((r) => r.monitor);
}
