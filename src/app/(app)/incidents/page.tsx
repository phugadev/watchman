import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Panel, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import { formatDuration } from "@/lib/metrics/uptime";
import { KIND_LABEL } from "@/lib/probe";
import { listIncidents } from "@/lib/queries";
import type { MonitorKind } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "open" },
  { key: "resolved", label: "resolved" },
  { key: "all", label: "all" },
] as const;

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const filter = (FILTERS.some((x) => x.key === f) ? f : "all") as
    | "open"
    | "resolved"
    | "all";

  const rows = listIncidents({ status: filter, limit: 200 });

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader label="incidents">
        <div className="flex items-center gap-1">
          {FILTERS.map((x) => (
            <Link
              key={x.key}
              href={`/incidents?f=${x.key}`}
              className={
                x.key === filter
                  ? "border-b border-amp px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-bone"
                  : "border-b border-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate hover:text-ash"
              }
            >
              {x.label}
            </Link>
          ))}
        </div>
      </SectionHeader>

      {rows.length === 0 ? (
        <EmptyState
          title={filter === "open" ? "nothing is broken" : "no incidents recorded"}
          hint={
            filter === "open"
              ? "Every monitor is currently responding as expected."
              : "Incidents appear here once a monitor fails enough consecutive checks to confirm an outage."
          }
        />
      ) : (
        <Panel className="divide-y divide-hairline-soft">
          {rows.map(({ incident, monitorName, monitorKind }) => {
            const duration = incident.resolvedAt
              ? incident.resolvedAt.getTime() - incident.startedAt.getTime()
              : Date.now() - incident.startedAt.getTime();

            return (
              <Link
                key={incident.id}
                href={`/incidents/${incident.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-panel-2"
              >
                <span
                  className={
                    incident.status === "resolved"
                      ? "size-2 shrink-0 bg-live"
                      : incident.status === "acknowledged"
                        ? "size-2 shrink-0 bg-amp"
                        : "size-2 shrink-0 anim-pulse bg-alarm"
                  }
                  aria-hidden
                />

                <span className="w-32 shrink-0 tnum font-mono text-[11px] text-slate">
                  {incident.startedAt.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>

                <span className="w-44 shrink-0 truncate text-[13px] text-bone">
                  {monitorName}
                </span>

                <MonoLabel tone="slate" className="hidden w-20 shrink-0 sm:block">
                  {KIND_LABEL[monitorKind as MonitorKind]}
                </MonoLabel>

                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ash">
                  {incident.cause ?? "Check failed"}
                </span>

                {incident.flapping ? (
                  <MonoLabel tone="amp" className="shrink-0">
                    flapping
                  </MonoLabel>
                ) : null}
                {incident.suppressed ? (
                  <MonoLabel tone="slate" className="shrink-0">
                    suppressed
                  </MonoLabel>
                ) : null}

                <span
                  className={
                    incident.resolvedAt
                      ? "w-20 shrink-0 text-right tnum font-mono text-[11px] text-ash"
                      : "w-20 shrink-0 text-right tnum font-mono text-[11px] text-alarm"
                  }
                >
                  {formatDuration(duration)}
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
