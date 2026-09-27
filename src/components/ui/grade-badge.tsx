import { cn } from "@/lib/cn";
import { GRADE_CAPTION, type Grade } from "@/lib/metrics/grade";

/* Six grades, six hues, each as a Minima tinted chip — text on a fill, which
   Minima guarantees legible in both modes. The letter carries the grade, so
   colour is never the only signal. D and F used to share red; they are two
   different verdicts and now read as two. */
const TONE_BG: Record<Grade, string> = {
  S: "border-cyan-border bg-cyan-fill text-cyan-text",
  A: "border-green-border bg-green-fill text-green-text",
  B: "border-blue-border bg-blue-fill text-blue-text",
  C: "border-amber-border bg-amber-fill text-amber-text",
  D: "border-orange-border bg-orange-fill text-orange-text",
  F: "border-red-border bg-red-fill text-red-text",
};

const SIZES = {
  xs: "size-5 rounded-mark type-caption-sm",
  sm: "size-7 rounded-mark type-body",
  md: "size-10 rounded-control-md type-heading",
  lg: "size-20 rounded-panel type-display",
  xl: "size-40 rounded-panel text-8xl",
} as const;

/**
 * GradeBadge — a solid square of colour with a single heavy letter.
 * No border, no radius, no gradient. It is the loudest object on any page it
 * appears on, which is the point: the grade is the summary.
 */
export function GradeBadge({
  grade,
  size = "md",
  className,
  title,
}: {
  grade: Grade;
  size?: keyof typeof SIZES;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title ?? `Grade ${grade} — ${GRADE_CAPTION[grade]}`}
      className={cn(
        "inline-grid shrink-0 place-items-center border font-sans font-bold leading-none",
        TONE_BG[grade],
        SIZES[size],
        className,
      )}
    >
      {grade}
    </span>
  );
}
