import { cn } from "@/lib/cn";
import { GRADE_CAPTION, type Grade } from "@/lib/metrics/grade";

const TONE_BG: Record<Grade, string> = {
  S: "bg-amp text-void",
  A: "bg-live text-void",
  B: "bg-info text-void",
  C: "bg-warn text-void",
  D: "bg-alarm text-bone",
  F: "bg-alarm text-bone",
};

const SIZES = {
  xs: "size-5 text-[11px]",
  sm: "size-7 text-sm",
  md: "size-10 text-lg",
  lg: "size-20 text-4xl",
  xl: "size-40 text-8xl",
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
        "inline-grid shrink-0 place-items-center font-sans font-bold leading-none tracking-tight",
        TONE_BG[grade],
        SIZES[size],
        className,
      )}
    >
      {grade}
    </span>
  );
}
