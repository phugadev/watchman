import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { CropFrame, EmptyState, Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { GradeBadge } from "@/components/ui/grade-badge";
import { MonoLabel, Readout } from "@/components/ui/mono";
import { StatusPill } from "@/components/ui/status";
import { MonitorCard } from "@/components/monitors/monitor-card";
import { GRADE_CAPTION } from "@/lib/metrics/grade";
import { formatDuration, formatMs, formatUptime } from "@/lib/metrics/uptime";
import {
  activeMaintenanceCount,
  fleetSummary,
  listIncidents,
  listMonitorsWithHealth,
  monitorsWithoutChannels,
} from "@/lib/queries";
import { schedulerStatus } from "@/lib/scheduler";

export const metadata: Metadata = { title: "Overview" };
// Always fresh: a cached monitoring dashboard is a lie with a timestamp on it.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const health = listMonitorsWithHealth();
  const fleet = fleetSummary(health);
  const openIncidents = listIncidents({ status: "open", limit: 5 });
  const unrouted = monitorsWithoutChannels();
  const scheduler = schedulerStatus();
  const activeMaintenance = activeMaintenanceCount();

  if (health.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHeader label="overview" />
        <EmptyState
          title="nothing is being watched yet"
          hint="Add your first monitor and Watchman will start probing it immediately. HTTP endpoints, TCP ports, TLS certificates, and cron heartbeats are all supported."
          action={
            <ButtonLink href="/monitors/new" variant="solid">
              Create the first monitor
            </ButtonLink>
          }
        />
      </div>
    );
  }

  // Order by urgency, not alphabetically: whatever is broken belongs first.
  const priority = { down: 0, degraded: 1, pending: 2, up: 3, paused: 4 } as const;
  const sorted = [...health].sort(
    (a, b) => priority[a.status] - priority[b.status] || a.monitor.name.localeCompare(b.monitor.name),
  );

  return (
    <div className="flex flex-col gap-10">
      {/* ---- hero readout ------------------------------------------------ */}
      <CropFrame hatch className="p-6 sm:p-8" tone={fleet.down > 0 ? "alarm" : "hairline"}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-6">
            <MonoLabel tone={fleet.down > 0 ? "alarm" : "amp"}>
              {fleet.down > 0
                ? `${fleet.down} monitor${fleet.down === 1 ? "" : "s"} down`
                : fleet.degraded > 0
                  ? `${fleet.degraded} degraded`
                  : "all systems operational"}
            </MonoLabel>

            <div className="flex flex-wrap items-end gap-8 sm:gap-12">
              <Readout
                label="fleet uptime · 24h"
                value={formatUptime(fleet.uptime24hPct)}
                hint={`${fleet.total} monitor${fleet.total === 1 ? "" : "s"} tracked`}
                size="lg"
                tone={fleet.uptime24hPct >= 99.9 ? "bone" : fleet.uptime24hPct >= 99 ? "warn" : "alarm"}
              />
              <Readout
                label="open incidents"
                value={fleet.openIncidents}
                hint={fleet.openIncidents === 0 ? "quiet" : "needs attention"}
                tone={fleet.openIncidents > 0 ? "alarm" : "live"}
              />
              {fleet.slowestP95 ? (
                <Readout
                  label="slowest p95"
                  value={formatMs(fleet.slowestP95.p95Ms)}
                  hint={fleet.slowestP95.name}
                  tone="bone"
                />
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2.5">
            <GradeBadge grade={fleet.overallGrade} size="lg" />
            <MonoLabel tone="slate">{GRADE_CAPTION[fleet.overallGrade]}</MonoLabel>
            <span className="tnum font-mono text-[10px] text-slate">
              {fleet.overallScore} / 100
            </span>
          </div>
        </div>

        <Rule className="my-6" />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <StatusPill status="up" label={`${fleet.up} up`} beacon={false} />
          <StatusPill status="degraded" label={`${fleet.degraded} degraded`} />
          <StatusPill status="down" label={`${fleet.down} down`} />
          {fleet.paused > 0 ? (
            <StatusPill status="paused" label={`${fleet.paused} paused`} beacon={false} />
          ) : null}
          {fleet.pending > 0 ? (
            <StatusPill status="pending" label={`${fleet.pending} pending`} beacon={false} />
          ) : null}

          <span className="ml-auto flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-slate">
            <span
              className={scheduler.running ? "size-1.5 anim-pulse bg-live" : "size-1.5 bg-alarm"}
              aria-hidden
            />
            {scheduler.running
              ? `scheduler up ${formatDuration(scheduler.uptimeMs)} · ${scheduler.ticks} ticks`
              : "scheduler stopped"}
          </span>
        </div>
      </CropFrame>

      {/* ---- active maintenance ------------------------------------------
           Stated up front, because an operator seeing a quiet dashboard needs to
           know whether it is quiet or muted. */}
      {activeMaintenance > 0 ? (
        <Panel className="flex flex-wrap items-center gap-x-4 gap-y-2 border-violet/30 bg-violet/5 px-4 py-3">
          <MonoLabel tone="amp">maintenance active</MonoLabel>
          <p className="min-w-0 flex-1 text-[12px] text-ash">
            {activeMaintenance === 1
              ? "A maintenance window is in effect — alerts are being withheld for the monitors it covers."
              : `${activeMaintenance} maintenance windows are in effect — alerts are being withheld for the monitors they cover.`}
          </p>
          <ButtonLink href="/maintenance" variant="bracket" size="sm">
            review
          </ButtonLink>
        </Panel>
      ) : null}

      {/* ---- open incidents --------------------------------------------- */}
      {openIncidents.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader label="open incidents">
            <Link
              href="/incidents"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate hover:text-amp"
            >
              all →
            </Link>
          </SectionHeader>

          <Panel className="divide-y divide-hairline-soft">
            {openIncidents.map(({ incident, monitorName }) => (
              <Link
                key={incident.id}
                href={`/incidents/${incident.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-panel-2"
              >
                <span
                  className={
                    incident.status === "acknowledged"
                      ? "size-2 shrink-0 bg-amp"
                      : "size-2 shrink-0 anim-pulse bg-alarm"
                  }
                  aria-hidden
                />
                <span className="w-40 shrink-0 truncate text-[13px] text-bone">
                  {monitorName}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ash">
                  {incident.cause ?? "Check failed"}
                </span>
                {incident.flapping ? (
                  <MonoLabel tone="amp" className="shrink-0">
                    flapping
                  </MonoLabel>
                ) : null}
                {incident.status === "acknowledged" ? (
                  <MonoLabel tone="amp" className="shrink-0">
                    acked
                  </MonoLabel>
                ) : null}
                <span className="shrink-0 tnum font-mono text-[11px] text-alarm">
                  {formatDuration(Date.now() - incident.startedAt.getTime())}
                </span>
              </Link>
            ))}
          </Panel>
        </section>
      ) : null}

      {/* ---- monitors ---------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeader label={`monitors · ${health.length}`}>
          <ButtonLink href="/monitors/new" variant="bracket" size="sm">
            new monitor
          </ButtonLink>
        </SectionHeader>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((h) => (
            <MonitorCard key={h.monitor.id} health={h} />
          ))}
        </div>
      </section>

      {/* ---- configuration warning --------------------------------------
           A monitor with no channel produces an alert nobody receives, which is
           the single most common way a self-hosted monitoring setup silently
           fails to do its job. Worth saying out loud. */}
      {unrouted.length > 0 ? (
        <Panel className="flex flex-wrap items-center gap-x-4 gap-y-2 border-warn/30 bg-warn/5 px-4 py-3">
          <MonoLabel tone="amp">no alert route</MonoLabel>
          <p className="min-w-0 flex-1 text-[12px] text-ash">
            {unrouted.length === 1
              ? `"${unrouted[0]!.name}" has no alert channel attached — if it goes down, nobody is told.`
              : `${unrouted.length} monitors have no alert channel attached — if they go down, nobody is told.`}
          </p>
          <ButtonLink href="/channels" variant="bracket" size="sm">
            set up alerts
          </ButtonLink>
        </Panel>
      ) : null}
    </div>
  );
}
