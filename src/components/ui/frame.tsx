import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Panel — the default raised surface. Square, hairline border, no shadow.
 * Depth in Watchman comes from border contrast, never from blur.
 */
export function Panel({
  children,
  className,
  as: Tag = "div",
  inset,
}: {
  children?: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside" | "li";
  inset?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "border border-hairline-soft bg-panel",
        inset && "p-4 sm:p-5",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * CropFrame — corner registration marks, borrowed from print production.
 * Used to frame the primary object on a page (the hero readout, a chart) so it
 * reads as "the measured thing" rather than "a card".
 */
export function CropFrame({
  children,
  className,
  tone = "hairline",
  size = 14,
  hatch,
}: {
  children?: ReactNode;
  className?: string;
  tone?: "hairline" | "amp" | "live" | "alarm";
  size?: number;
  hatch?: boolean;
}) {
  const stroke = {
    hairline: "border-hairline",
    amp: "border-amp",
    live: "border-live",
    alarm: "border-alarm",
  }[tone];

  const corner = "pointer-events-none absolute";
  const dim = { width: size, height: size };

  return (
    <div className={cn("relative", hatch && "hatch", className)}>
      <span
        aria-hidden
        className={cn(corner, "left-0 top-0 border-l border-t", stroke)}
        style={dim}
      />
      <span
        aria-hidden
        className={cn(corner, "right-0 top-0 border-r border-t", stroke)}
        style={dim}
      />
      <span
        aria-hidden
        className={cn(corner, "bottom-0 left-0 border-b border-l", stroke)}
        style={dim}
      />
      <span
        aria-hidden
        className={cn(corner, "bottom-0 right-0 border-b border-r", stroke)}
        style={dim}
      />
      {children}
    </div>
  );
}

/**
 * HatchFrame — a dashed/hatched border region. Signals "container", "pending",
 * or "nothing here yet" without resorting to grey mush.
 */
export function HatchFrame({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "hatch border border-dashed border-hairline-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A dotted horizontal rule. */
export function Rule({ className }: { className?: string }) {
  return <hr aria-hidden className={cn("rule-dotted border-0", className)} />;
}

/**
 * SectionHeader — `> LABEL` in mono caps, with an optional right-hand slot.
 * Every major region on every page opens with one of these.
 */
export function SectionHeader({
  label,
  children,
  className,
}: {
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <h2 className="flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ash">
        <span className="text-slate" aria-hidden>
          &gt;
        </span>
        {label}
      </h2>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * EmptyState — hatched frame, mono copy, one action. Deliberately not cute.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <HatchFrame className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ash">
        {title}
      </p>
      {hint ? (
        <p className="max-w-sm text-sm leading-relaxed text-slate">{hint}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </HatchFrame>
  );
}
