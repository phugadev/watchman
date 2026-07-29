import { cn } from "@/lib/cn";
import { MonoLabel } from "@/components/ui/mono";
import { formatDuration, type SloBudget } from "@/lib/metrics/uptime";

/**
 * SLO error-budget burn-down.
 *
 * The single most actionable number in the product. "99.87% uptime" requires
 * arithmetic before it means anything; "you have 6 minutes of downtime left this
 * month" answers the question people are actually asking, which is whether it is
 * safe to ship right now.
 */
export function BudgetBar({
  budget,
  className,
}: {
  budget: SloBudget;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, budget.burnRatio * 100));
  const tone = budget.exhausted
    ? "bg-alarm"
    : pct > 75
      ? "bg-warn"
      : "bg-live";

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <MonoLabel>error budget</MonoLabel>
        <MonoLabel tone={budget.exhausted ? "alarm" : "bone"}>
          {Number.isFinite(budget.burnRatio)
            ? `${pct.toFixed(0)}% burned`
            : "no budget"}
        </MonoLabel>
      </div>

      <div className="relative h-2.5 w-full overflow-hidden border border-hairline-soft bg-void">
        <div
          className={cn("h-full transition-[width] duration-500 ease-[var(--ease-instrument)]", tone)}
          style={{ width: `${pct}%` }}
        />
        {/* Quarter ticks, so the eye can read the fill without a percentage. */}
        {[25, 50, 75].map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute top-0 h-full w-px bg-void/70"
            style={{ left: `${t}%` }}
          />
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 tnum font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className={budget.exhausted ? "text-alarm" : "text-ash"}>
          {budget.exhausted
            ? `over by ${formatDuration(budget.consumedMs - budget.allowedMs)}`
            : `${formatDuration(budget.remainingMs)} left`}
        </span>
        <span className="text-slate">
          {budget.targetPct}% target · {formatDuration(budget.allowedMs)} allowed
        </span>
      </div>
    </div>
  );
}

/**
 * Grade breakdown: the three components behind a letter.
 *
 * Shown because an unexplained grade is untrustworthy. Seeing that latency, not
 * uptime, is what cost you an S tells you where to look.
 */
export function GradeBreakdown({
  parts,
  score,
  className,
}: {
  parts: { uptime: number; latency: number | null; stability: number };
  score: number;
  className?: string;
}) {
  const rows = [
    { label: "uptime", value: parts.uptime, weight: "65%" },
    { label: "latency", value: parts.latency, weight: "20%" },
    { label: "stability", value: parts.stability, weight: "15%" },
  ];

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <MonoLabel className="w-[4.5rem] shrink-0">{r.label}</MonoLabel>
          <div className="h-1.5 flex-1 overflow-hidden bg-void">
            <div
              className={cn(
                "h-full",
                r.value === null
                  ? "bg-hairline"
                  : r.value >= 85
                    ? "bg-live"
                    : r.value >= 60
                      ? "bg-warn"
                      : "bg-alarm",
              )}
              style={{ width: `${r.value ?? 0}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right tnum font-mono text-[10px] text-ash">
            {r.value === null ? "n/a" : r.value.toFixed(0)}
          </span>
          <span className="w-8 shrink-0 text-right tnum font-mono text-[9px] text-slate">
            {r.weight}
          </span>
        </div>
      ))}
      <div className="rule-dotted mt-1 pt-2.5">
        <div className="flex items-baseline justify-between">
          <MonoLabel tone="bone">composite</MonoLabel>
          <span className="tnum font-mono text-[13px] text-amp">
            {score.toFixed(1)}
            <span className="text-slate"> / 100</span>
          </span>
        </div>
      </div>
    </div>
  );
}
