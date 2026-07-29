import { cn } from "@/lib/cn";

/**
 * The Watchman mark: a viewfinder. Four registration corners closing in on a
 * single live pip — the same crop-mark language the rest of the UI is built from,
 * so the logo is literally a component of the design system rather than a sticker
 * applied on top of it.
 */
export function Mark({
  className,
  size = 20,
  live = true,
}: {
  className?: string;
  size?: number;
  live?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      {/* corner registration marks */}
      <path
        d="M1 7V1h6M17 1h6v6M23 17v6h-6M7 23H1v-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
      {/* the pip */}
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        className={live ? "fill-amp" : "fill-slate"}
      />
    </svg>
  );
}

export function Wordmark({
  className,
  size = 20,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={size} className="text-bone" />
      <span className="font-sans text-[15px] font-semibold tracking-tight text-bone">
        Watchman
      </span>
    </span>
  );
}
