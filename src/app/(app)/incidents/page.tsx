import type { Metadata } from "next";
import Link from "next/link";
import { LinkTabs } from "@/components/link-tabs";
import { EmptyState, Panel } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import { formatDuration } from "@/lib/metrics/uptime";
import { KIND_LABEL } from "@/lib/probe";
import { listIncidents } from "@/lib/queries";

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
      <LinkTabs
        label="incidents"
        value={filter}
        items={FILTERS.map((x) => ({ value: x.key, label: x.label, href: `/incidents?f=${x.key}` }))}
      >

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
        <Panel className="divide-y divide-border">
          {rows.map(({ incident, monitorName, monitorKind }) => {
            const duration = incident.resolvedAt
              ? incident.resolvedAt.getTime() - incident.startedAt.getTime()
              : Date.now() - incident.startedAt.getTime();

            return (
              <Link
                key={incident.id}
                href={`/incidents/${incident.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted"
              >
                <span
                  className={
                    incident.status === "resolved"
                      ? "size-2 shrink-0 bg-green-mark"
                      : incident.status === "acknowledged"
                        ? "size-2 shrink-0 bg-primary"
                        : "size-2 shrink-0 anim-pulse bg-red-mark"
                  }
                  aria-hidden
                />

                <span className="w-32 shrink-0 tabular-nums font-mono type-caption-sm text-subtle-foreground">
                  {incident.startedAt.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>

                <span className="w-44 shrink-0 truncate type-caption text-foreground">
                  {monitorName}
                </span>

                <MonoLabel tone="slate" className="hidden w-20 shrink-0 sm:block">
                  {KIND_LABEL[monitorKind]}
                </MonoLabel>

                <span className="min-w-0 flex-1 truncate font-mono type-caption-sm text-muted-foreground">
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
                      ? "w-20 shrink-0 text-right tabular-nums font-mono type-caption-sm text-muted-foreground"
                      : "w-20 shrink-0 text-right tabular-nums font-mono type-caption-sm text-red-text"
                  }
                >
                  {formatDuration(duration)}
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
      </LinkTabs>
    </div>
  );
}
