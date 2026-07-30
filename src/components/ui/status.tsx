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
 *
 * The pip is decorative, but the *status* is not. Where the dot appears without an
 * adjacent text label — the monitors table, the dashboard cards — it carries a
 * visually-hidden one, otherwise the row's state is conveyed by colour alone and a
 * screen reader announces nothing at all. Pass `labelled={false}` only when visible
 * text right next to it already says the same thing, as StatusPill does.
 */
export function StatusDot({
  status,
  beacon = false,
  className,
  labelled = true,
}: {
  status: MonitorStatus;
  beacon?: boolean;
  className?: string;
  labelled?: boolean;
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
      <span className={cn("relative size-2", DOT_TONE[status])} aria-hidden />
      {labelled ? <span className="sr-only">{STATUS_LABEL[status]}</span> : null}
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
      {/* The pill already renders the status as text, so the dot must not repeat it. */}
      <StatusDot status={status} beacon={beacon} labelled={false} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export interface TapeBucket {
  label: string;
  status: MonitorStatus;
  detail?: string;
}

/** Shape cues so the state survives without colour. See globals.css. */
const TAPE_PATTERN: Partial<Record<MonitorStatus, string>> = {
  degraded: "tape-degraded",
  down: "tape-down",
  paused: "tape-down",
};

/**
 * Turn the strip into a sentence.
 *
 * The old aria-label read "Uptime history across 90 buckets", which tells a screen
 * reader user the number of bars and nothing whatsoever about the service — the exact
 * information the graphic exists to convey. This says what actually happened.
 */
export function summariseTape(buckets: readonly TapeBucket[]): string {
  if (buckets.length === 0) return "Uptime history: no data yet.";

  const counts = { up: 0, degraded: 0, down: 0, paused: 0, pending: 0 };
  for (const b of buckets) counts[b.status]++;

  const measured = buckets.length - counts.pending;

  // A leading verdict, then the breakdown. An earlier draft opened with a ratio and
  // produced "31 of 31 periods had problems", which is accurate and reads like a
  // riddle — the summary has to work as a spoken sentence, not a statistic.
  const verdict =
    measured === 0
      ? "No data recorded yet"
      : counts.down > 0
        ? `${counts.down} ${counts.down === 1 ? "period" : "periods"} with an outage`
        : counts.degraded > 0
          ? "No outages, but some periods were degraded"
          : "No outages recorded";

  const parts: string[] = [];
  if (counts.up > 0) parts.push(`${counts.up} fully operational`);
  if (counts.degraded > 0) parts.push(`${counts.degraded} degraded`);
  if (counts.down > 0) parts.push(`${counts.down} with an outage`);
  if (counts.paused > 0) parts.push(`${counts.paused} paused`);
  if (counts.pending > 0) parts.push(`${counts.pending} with no data`);

  return `Uptime history, ${buckets.length} periods oldest first. ${verdict}. Breakdown: ${parts.join(", ")}.`;
}

/**
 * The uptime strip — one bar per period, oldest on the left.
 *
 * Three accessibility properties are load-bearing here, and this is the one component
 * that renders on a *public* page where the audience is not colleagues:
 *
 *   1. Status is never carried by colour alone. Degraded and down get a shape cue too,
 *      because red and mint are close to identical to a red-green colour-blind reader.
 *   2. The graphic has a real text alternative — what happened, not how many bars.
 *   3. Per-period detail exists as text, not only as a `title` tooltip, which keyboard
 *      users cannot reach and screen readers announce inconsistently. Only the periods
 *      that were not fully operational are listed: ninety readings of "operational"
 *      is noise that would bury the two days that matter.
 */
export function UptimeTape({
  buckets,
  className,
  height = 34,
}: {
  buckets: readonly TapeBucket[];
  className?: string;
  height?: number;
}) {
  const notable = buckets.filter(
    (b) => b.status !== "up" && b.status !== "pending",
  );

  return (
    <div className={className}>
      <div
        className="flex w-full items-stretch gap-px"
        style={{ height }}
        role="img"
        aria-label={summariseTape(buckets)}
      >
        {buckets.map((b, i) => (
          <div
            key={i}
            // Retained for mouse users as a convenience; the text below is the
            // accessible equivalent, so this is additive rather than the only route.
            title={b.detail ? `${b.label} — ${b.detail}` : b.label}
            className={cn(
              "min-w-px flex-1 transition-opacity duration-150 hover:opacity-60",
              DOT_TONE[b.status],
              TAPE_PATTERN[b.status],
              b.status === "pending" && "opacity-40",
            )}
          />
        ))}
      </div>

      {notable.length > 0 ? (
        <ul className="sr-only">
          {notable.map((b, i) => (
            <li key={i}>
              {b.label}: {STATUS_LABEL[b.status]}
              {b.detail ? `, ${b.detail}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The key for the tape.
 *
 * Worth showing to everyone, not only as an accessibility aid: without it, an amber bar
 * means nothing until you hover one, and hovering is not available on a phone — which is
 * where most status-page traffic arrives.
 */
export function UptimeTapeLegend({ className }: { className?: string }) {
  const items: { status: MonitorStatus; label: string }[] = [
    { status: "up", label: "Operational" },
    { status: "degraded", label: "Degraded" },
    { status: "down", label: "Outage" },
    { status: "pending", label: "No data" },
  ];

  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-slate",
        className,
      )}
    >
      {items.map(({ status, label }) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "h-3 w-2 shrink-0",
              DOT_TONE[status],
              TAPE_PATTERN[status],
              status === "pending" && "opacity-40",
            )}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
