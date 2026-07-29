import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import { MaintenanceForm } from "@/components/maintenance/maintenance-form";
import { requireUser } from "@/lib/auth/session";
import {
  deleteMaintenanceAction,
  endMaintenanceNowAction,
} from "@/lib/maintenance/actions";
import { formatDuration } from "@/lib/metrics/uptime";
import { listMaintenanceWindows, listMonitorsWithHealth } from "@/lib/queries";
import type { MaintenancePhase } from "@/lib/maintenance/phase";

export const metadata: Metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";

const PHASE_TONE: Record<MaintenancePhase, string> = {
  active: "bg-violet",
  scheduled: "bg-amp",
  finished: "bg-slate",
};

export default async function MaintenancePage() {
  // Members can see what is suppressed and why — during an incident that is exactly
  // the question — but scheduling is an admin action, since it is the one control that
  // can make Watchman go quiet during a real outage.
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const windows = listMaintenanceWindows();
  const monitors = listMonitorsWithHealth(0);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader label="maintenance windows">
        {isAdmin ? (
          <MaintenanceForm
            monitors={monitors.map((m) => ({
              id: m.monitor.id,
              name: m.monitor.name,
              kind: m.monitor.kind,
            }))}
          />
        ) : (
          <MonoLabel tone="slate">read only</MonoLabel>
        )}
      </SectionHeader>

      <p className="max-w-2xl text-[13px] leading-relaxed text-ash">
        A window silences alerts for a planned change without losing the data.
        Suppressing keeps probing and recording, so the incident timeline afterwards
        still shows what happened — nobody is just paged for it. Pausing stops probing
        entirely, for maintenance where the service is deliberately offline.
      </p>

      {windows.length === 0 ? (
        <EmptyState
          title="no maintenance windows"
          hint="Schedule one before a deploy or a database migration, and Watchman will stay quiet for the duration instead of paging whoever is on call."
        />
      ) : (
        <Panel className="divide-y divide-hairline-soft">
          {windows.map(({ window, monitors: affected, phase }) => (
            <div
              key={window.id}
              className="flex flex-col gap-2.5 px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span
                  className={`size-2 shrink-0 ${PHASE_TONE[phase]} ${phase === "active" ? "anim-pulse" : ""}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[14px] text-bone">
                  {window.title}
                </span>

                <MonoLabel tone={phase === "active" ? "amp" : "slate"}>
                  {phase === "active"
                    ? `active · ${formatDuration(window.endsAt.getTime() - Date.now())} left`
                    : phase === "scheduled"
                      ? `in ${formatDuration(window.startsAt.getTime() - Date.now())}`
                      : "finished"}
                </MonoLabel>

                {isAdmin ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {phase === "active" ? (
                      <form action={endMaintenanceNowAction}>
                        <input type="hidden" name="id" value={window.id} />
                        <Button type="submit" variant="bracket" size="sm">
                          end now
                        </Button>
                      </form>
                    ) : null}
                    <form action={deleteMaintenanceAction}>
                      <input type="hidden" name="id" value={window.id} />
                      <Button
                        type="submit"
                        variant="bracket"
                        size="sm"
                        className="hover:text-alarm"
                      >
                        delete
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tnum font-mono text-[10px] uppercase tracking-[0.14em] text-slate">
                <span>
                  {window.startsAt.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" → "}
                  {window.endsAt.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {window.suppressAlerts ? "alerts suppressed" : ""}
                  {window.suppressAlerts && window.pauseChecks ? " + " : ""}
                  {window.pauseChecks ? "checks paused" : ""}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {affected.length === 0 ? (
                  <MonoLabel tone="alarm">no monitors attached</MonoLabel>
                ) : (
                  affected.map((m) => (
                    <Link
                      key={m.id}
                      href={`/monitors/${m.id}`}
                      className="font-mono text-[11px] text-ash hover:text-amp hover:underline"
                    >
                      {m.name}
                    </Link>
                  ))
                )}
              </div>

              {window.notes ? (
                <p className="text-[12px] leading-relaxed text-slate">{window.notes}</p>
              ) : null}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
