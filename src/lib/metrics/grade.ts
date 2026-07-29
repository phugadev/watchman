/**
 * Watchman grades every monitor S → F.
 *
 * A raw uptime percentage is a bad headline number: 99.5% and 99.9% look nearly
 * identical to the eye but differ by 2 hours of downtime a month. A grade forces
 * the difference to be legible, and it folds in the two other things that
 * actually matter — how slow the endpoint is, and how *often* it breaks (ten
 * one-minute outages are worse operationally than one ten-minute outage, even
 * though uptime is identical).
 *
 * Every number here is an explicit, tunable anchor rather than a clever formula,
 * so the scoring stays inspectable and testable.
 */

export type Grade = "S" | "A" | "B" | "C" | "D" | "F";

export const GRADES: readonly Grade[] = ["S", "A", "B", "C", "D", "F"] as const;

/** Piecewise-linear interpolation over descending-x or ascending-x anchors. */
function interpolate(anchors: readonly [number, number][], x: number): number {
  const pts = [...anchors].sort((a, b) => a[0] - b[0]);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    if (x >= x0 && x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

/**
 * Uptime → subscore. Anchored so that each additional "nine" is worth
 * meaningfully more than the last, which matches how operators actually feel it.
 */
const UPTIME_ANCHORS: readonly [number, number][] = [
  [0, 0],
  [90, 18],
  [95, 38],
  [98, 58],
  [99, 72],
  [99.5, 82],
  [99.9, 92],
  [99.99, 98],
  [100, 100],
];

/** p95 latency in ms → subscore. Sub-200ms is free; 3s is close to failure. */
const LATENCY_ANCHORS: readonly [number, number][] = [
  [0, 100],
  [150, 100],
  [300, 90],
  [500, 78],
  [900, 60],
  [1500, 42],
  [3000, 18],
  [8000, 0],
];

/** Incidents per 30 days → subscore. Punishes flapping. */
const INCIDENT_ANCHORS: readonly [number, number][] = [
  [0, 100],
  [1, 88],
  [2, 76],
  [3, 64],
  [5, 45],
  [8, 24],
  [12, 0],
];

export const GRADE_WEIGHTS = {
  uptime: 0.65,
  latency: 0.2,
  stability: 0.15,
} as const;

export const GRADE_CUTOFFS: readonly { grade: Grade; min: number }[] = [
  { grade: "S", min: 95 },
  { grade: "A", min: 87 },
  { grade: "B", min: 76 },
  { grade: "C", min: 62 },
  { grade: "D", min: 45 },
  { grade: "F", min: 0 },
];

export interface GradeInput {
  /** Uptime as a percentage, 0–100. */
  uptimePct: number;
  /** p95 response time in ms. Omit for check types with no meaningful latency. */
  p95Ms?: number | null;
  /** Incident count normalised to a 30-day window. */
  incidentsPer30d?: number;
}

export interface GradeResult {
  grade: Grade;
  /** Composite score, 0–100. */
  score: number;
  parts: {
    uptime: number;
    latency: number | null;
    stability: number;
  };
}

/**
 * Compute a monitor's grade. When latency is unavailable (heartbeats, for
 * example) its weight is redistributed across the remaining components rather
 * than scored as zero.
 */
export function computeGrade(input: GradeInput): GradeResult {
  const uptime = clamp(interpolate(UPTIME_ANCHORS, clamp(input.uptimePct)));
  const stability = clamp(
    interpolate(INCIDENT_ANCHORS, Math.max(0, input.incidentsPer30d ?? 0)),
  );

  const hasLatency =
    input.p95Ms !== null && input.p95Ms !== undefined && input.p95Ms >= 0;
  const latency = hasLatency
    ? clamp(interpolate(LATENCY_ANCHORS, input.p95Ms as number))
    : null;

  let score: number;
  if (latency === null) {
    const total = GRADE_WEIGHTS.uptime + GRADE_WEIGHTS.stability;
    score =
      (uptime * GRADE_WEIGHTS.uptime + stability * GRADE_WEIGHTS.stability) /
      total;
  } else {
    score =
      uptime * GRADE_WEIGHTS.uptime +
      latency * GRADE_WEIGHTS.latency +
      stability * GRADE_WEIGHTS.stability;
  }

  score = Math.round(clamp(score) * 10) / 10;
  const grade =
    GRADE_CUTOFFS.find((c) => score >= c.min)?.grade ??
    ("F" as Grade);

  return { grade, score, parts: { uptime, latency, stability } };
}

/** Tailwind token name carrying each grade's colour. */
export const GRADE_TONE: Record<Grade, "amp" | "live" | "info" | "warn" | "alarm"> =
  {
    S: "amp",
    A: "live",
    B: "info",
    C: "warn",
    D: "alarm",
    F: "alarm",
  };

/**
 * sRGB hex equivalents of the oklch tokens, for contexts with no Tailwind and no
 * guarantee of CSS Color 4 support: SVG badges, emails, image converters.
 *
 * Hardcoded rather than computed at runtime, and hex rather than oklch(), because a
 * README badge gets rendered by GitHub's camo proxy, feed readers, and screenshot
 * pipelines — anything that does not understand oklch would draw it black.
 */
export const GRADE_HEX: Record<Grade, string> = {
  S: "#fbd509", // amp
  A: "#52cd86", // live
  B: "#3e98ff", // info
  C: "#ff9d36", // warn
  D: "#ff4945", // alarm
  F: "#ff4945", // alarm
};

/** Neutral hexes used alongside GRADE_HEX in the same non-CSS contexts. */
export const BADGE_HEX = {
  label: "#161b16", // panel-2
  labelText: "#979d97", // ash
  valueText: "#080b08", // void
  inactive: "#646b65", // slate
} as const;

export const GRADE_CAPTION: Record<Grade, string> = {
  S: "Flawless",
  A: "Healthy",
  B: "Acceptable",
  C: "Degraded",
  D: "Unreliable",
  F: "Failing",
};
