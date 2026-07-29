import { cn } from "@/lib/cn";
import type { MonitorStatus } from "@/lib/metrics/uptime";

const DOT_TONE: Record<MonitorStatus, string> = {
  up: "bg-live",
  degraded: "bg-warn",
  down: "bg-alarm",
  paused: "bg-slate",
  pending: "bg-hairline",
};

const TEXT_TONE: Record<MonitorStatus, string> = {
  up: "text-live",
  degraded: "text-warn",
  down: "text-alarm",
  paused: "text-slate",
  pending: "text-ash",
};

export const STATUS_LABEL: Record<MonitorStatus, string> = {
  up: "Operational",
  degraded: "Degraded",
  down: "Down",
  paused: "Paused",
  pending: "Pending",
};

/**
 * StatusDot — a square pip, not a circle. `beacon` adds an expanding ring for
 * states that demand attention, so a down monitor is findable in peripheral
 * vision.
 */
export function StatusDot({
  status,
  beacon = false,
  className,
}: {
  status: MonitorStatus;
  beacon?: boolean;
  className?: string;
}) {
  const active = beacon && (status === "down" || status === "degraded");
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {active ? (
        <span
          aria-hidden
          className={cn("absolute inset-0", DOT_TONE[status])}
          style={{ animation: "wm-ping 1.8s var(--ease-instrument) infinite" }}
        />
      ) : null}
      <span
        className={cn("relative size-2", DOT_TONE[status])}
        aria-hidden
      />
    </span>
  );
}

/** StatusPill — dot + label in mono caps. */
export function StatusPill({
  status,
  beacon = true,
  className,
  label,
}: {
  status: MonitorStatus;
  beacon?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]",
        TEXT_TONE[status],
        className,
      )}
    >
      <StatusDot status={status} beacon={beacon} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Tape — the 90-day (or N-bucket) uptime strip. Each bar is one bucket; height
 * is constant, colour carries the state. Gaps between bars are 1px so a long
 * outage reads as a solid red block.
 */
export function UptimeTape({
  buckets,
  className,
  height = 34,
}: {
  buckets: readonly {
    label: string;
    status: MonitorStatus;
    detail?: string;
  }[];
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={cn("flex w-full items-stretch gap-px", className)}
      style={{ height }}
      role="img"
      aria-label={`Uptime history across ${buckets.length} buckets`}
    >
      {buckets.map((b, i) => (
        <div
          key={i}
          title={b.detail ? `${b.label} — ${b.detail}` : b.label}
          className={cn(
            "min-w-px flex-1 transition-opacity duration-150 hover:opacity-60",
            DOT_TONE[b.status],
            b.status === "pending" && "opacity-40",
          )}
        />
      ))}
    </div>
  );
}
