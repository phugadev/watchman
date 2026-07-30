import Link from "next/link";
import { cn } from "@/lib/cn";
import { GradeBadge } from "@/components/ui/grade-badge";
import { MonoLabel } from "@/components/ui/mono";
import { StatusDot, STATUS_LABEL } from "@/components/ui/status";
import { KIND_LABEL } from "@/lib/probe";
import { formatAgo, formatMs, formatUptime } from "@/lib/metrics/uptime";
import type { MonitorHealth } from "@/lib/queries";

/**
 * One monitor in the grid.
 *
 * Ordered by how fast each part needs to be read: status pip and name first, then
 * the sparkline shape, then the numbers, then the grade as the summary anchor on
 * the right. A card in trouble gains a coloured left edge so a failing monitor is
 * findable in peripheral vision without reading a word.
 */
export function MonitorCard({ health }: { health: MonitorHealth }) {
  const { monitor, status, summary24h, grade, tape } = health;

  const edge =
    status === "down"
      ? "before:bg-alarm"
      : status === "degraded"
        ? "before:bg-warn"
        : status === "paused"
          ? "before:bg-slate"
          : "before:bg-transparent";

  return (
    <Link
      href={`/monitors/${monitor.id}`}
      className={cn(
        "group relative flex flex-col gap-4 border border-hairline-soft bg-panel p-4 transition-colors duration-150 hover:border-hairline hover:bg-panel-2",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-['']",
        edge,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <StatusDot status={status} beacon />
            <span className="truncate text-[14px] font-medium tracking-tight text-bone">
              {monitor.name}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-slate">
            <span>{KIND_LABEL[monitor.kind]}</span>
            <span aria-hidden>·</span>
            <span className="truncate">
              {monitor.kind === "heartbeat"
                ? `every ${monitor.intervalSec}s`
                : stripScheme(monitor.target)}
            </span>
          </div>
        </div>

        <GradeBadge
          grade={grade}
          size="sm"
          title={`Grade ${grade} over the last 24h`}
        />
      </div>

      <Sparkline tape={tape} />

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="24h"
          value={summary24h.total === 0 ? "—" : formatUptime(summary24h.uptimePct)}
          title={`${summary24h.total} checks · ${summary24h.downCount} failed`}
        />
        {/* Aggregated from hourly buckets, so it is close but not the exact 24h
            percentile — the monitor page computes that from raw checks. Said out loud
            here rather than letting the two quietly disagree. */}
        <Stat
          label="p95"
          value={formatMs(summary24h.p95Ms)}
          title="Approximate — weighted across hourly buckets. Open the monitor for the exact figure."
        />
        <Stat
          label="last"
          value={
            status === "paused"
              ? STATUS_LABEL.paused
              : formatAgo(monitor.lastCheckedAt)
          }
        />
      </div>

      {monitor.lastError && status !== "paused" ? (
        <p className="truncate border-l-2 border-alarm/40 pl-2 font-mono text-[10px] text-alarm">
          {monitor.lastError}
        </p>
      ) : null}
    </Link>
  );
}

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-1" title={title}>
      <MonoLabel tone="slate">{label}</MonoLabel>
      <span className="tnum font-mono text-[12px] text-bone">{value}</span>
    </div>
  );
}

/**
 * A bar-per-check strip. Bar height encodes latency relative to the window's peak,
 * colour encodes status — so a slow patch and an outage look different at a glance
 * even though both are "not green".
 */
function Sparkline({
  tape,
}: {
  tape: { status: string; latencyMs: number | null; at: number }[];
}) {
  if (tape.length === 0) {
    return (
      <div className="hatch h-9 border border-dashed border-hairline-soft" aria-hidden />
    );
  }

  const peak = Math.max(1, ...tape.map((t) => t.latencyMs ?? 0));

  return (
    <div className="flex h-9 items-end gap-px" aria-hidden>
      {tape.map((t, i) => {
        const tone =
          t.status === "down"
            ? "bg-alarm"
            : t.status === "degraded"
              ? "bg-warn"
              : "bg-live/70 group-hover:bg-live";
        // Failures have no latency, so they render full height: an outage should be
        // the tallest thing in the strip, not the shortest.
        const pct =
          t.status === "down"
            ? 100
            : Math.max(12, ((t.latencyMs ?? 0) / peak) * 100);
        return (
          <span
            key={i}
            className={cn("min-w-px flex-1 transition-colors", tone)}
            style={{ height: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}

function stripScheme(target: string): string {
  return target.replace(/^https?:\/\//, "") || "—";
}
