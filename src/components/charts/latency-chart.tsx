import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/metrics/uptime";
import type { MonitorStatus } from "@/lib/metrics/uptime";

export interface SeriesPoint {
  at: number;
  latencyMs: number | null;
  minMs?: number | null;
  maxMs?: number | null;
  status: MonitorStatus;
}

/**
 * Latency over time, hand-rolled SVG.
 *
 * No charting library: the requirement is one shape with a min/max band, failure
 * markers, and a threshold rule, and every library that draws that also drags in
 * its own opinions about typography and colour that would have to be fought back.
 * Server-rendered as inline SVG, so it costs no client JavaScript at all.
 */
export function LatencyChart({
  data,
  degradedMs,
  height = 200,
  className,
}: {
  data: readonly SeriesPoint[];
  degradedMs?: number | null;
  height?: number;
  className?: string;
}) {
  const W = 1000;
  const H = height;
  const PAD = { top: 12, right: 8, bottom: 18, left: 8 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const withLatency = data.filter(
    (d) => typeof d.latencyMs === "number" && Number.isFinite(d.latencyMs),
  );

  if (withLatency.length === 0) {
    return (
      <div
        className={cn(
          "grid-paper flex items-center justify-center border border-hairline-soft",
          className,
        )}
        style={{ height }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate">
          no latency data in this window
        </span>
      </div>
    );
  }

  const values = withLatency.flatMap((d) => [
    d.latencyMs!,
    d.maxMs ?? d.latencyMs!,
    d.minMs ?? d.latencyMs!,
  ]);

  // Headroom above the peak so the line never touches the frame, and the degraded
  // threshold stays visible even when everything is comfortably under it.
  const rawMax = Math.max(...values, degradedMs ?? 0);
  const yMax = rawMax * 1.15 || 100;

  const t0 = data[0]!.at;
  const t1 = data[data.length - 1]!.at;
  const span = Math.max(1, t1 - t0);

  const x = (at: number) => PAD.left + ((at - t0) / span) * plotW;
  const y = (ms: number) => PAD.top + plotH - (ms / yMax) * plotH;

  const line = withLatency
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(d.at).toFixed(1)} ${y(d.latencyMs!).toFixed(1)}`)
    .join(" ");

  // Fill under the line, closed along the baseline.
  const area = `${line} L${x(withLatency[withLatency.length - 1]!.at).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L${x(withLatency[0]!.at).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;

  // The min/max envelope, drawn only when the series carries aggregated buckets.
  const hasBand = withLatency.some((d) => d.minMs != null && d.maxMs != null);
  const band = hasBand
    ? [
        ...withLatency.map(
          (d, i) =>
            `${i === 0 ? "M" : "L"}${x(d.at).toFixed(1)} ${y(d.maxMs ?? d.latencyMs!).toFixed(1)}`,
        ),
        ...[...withLatency]
          .reverse()
          .map((d) => `L${x(d.at).toFixed(1)} ${y(d.minMs ?? d.latencyMs!).toFixed(1)}`),
        "Z",
      ].join(" ")
    : null;

  const failures = data.filter((d) => d.status === "down");
  const gridLines = [0.25, 0.5, 0.75];

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`Response time, ${withLatency.length} points, peak ${formatMs(rawMax)}`}
      >
        <defs>
          <linearGradient id="wm-latency-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-amp)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-amp)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((f) => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + plotH * f}
            y2={PAD.top + plotH * f}
            stroke="var(--color-hairline-soft)"
            strokeWidth="1"
            strokeDasharray="2 5"
          />
        ))}

        {/* Failure markers sit behind the line as full-height columns, so an
            outage reads as a gap in service rather than a dot to hunt for. */}
        {failures.map((d, i) => (
          <line
            key={`f${i}`}
            x1={x(d.at)}
            x2={x(d.at)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--color-alarm)"
            strokeWidth="2"
            strokeOpacity="0.45"
          />
        ))}

        {band ? (
          <path d={band} fill="var(--color-amp)" fillOpacity="0.1" stroke="none" />
        ) : null}

        <path d={area} fill="url(#wm-latency-fill)" stroke="none" />

        {degradedMs ? (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(degradedMs)}
            y2={y(degradedMs)}
            stroke="var(--color-warn)"
            strokeWidth="1"
            strokeDasharray="6 4"
            strokeOpacity="0.8"
          />
        ) : null}

        <path
          d={line}
          fill="none"
          stroke="var(--color-amp)"
          strokeWidth="1.75"
          // preserveAspectRatio="none" scales strokes non-uniformly; this keeps the
          // line an even weight instead of stretching it horizontally.
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>

      {/* Axis labels live in HTML rather than SVG text so they are not distorted
          by the non-uniform viewBox scaling. */}
      <div className="pointer-events-none absolute right-1 top-0 tnum font-mono text-[9px] text-slate">
        {formatMs(yMax)}
      </div>
      {degradedMs ? (
        <div
          className="pointer-events-none absolute left-1 tnum font-mono text-[9px] text-warn"
          style={{ top: `${(y(degradedMs) / H) * 100}%`, transform: "translateY(-120%)" }}
        >
          degraded {formatMs(degradedMs)}
        </div>
      ) : null}
      <div className="mt-1 flex justify-between tnum font-mono text-[9px] text-slate">
        <span>{new Date(t0).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <span>now</span>
      </div>
    </div>
  );
}
