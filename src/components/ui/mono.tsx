import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Stat, StatLabel, StatValue } from "./stat";

/*
 * Watchman's labelling vocabulary, on Minima's registers: labels are the
 * signal voice (mono, uppercase, tracked — scanned, never read) and values are
 * the figure voice (mono, tabular — compared down a column).
 *
 * The tone names are Watchman's and stay so call sites read the same; each one
 * resolves to a Minima role. `amp` was the acid-yellow attention colour and is
 * now emphasis — the foreground — because Minima keeps hue for state.
 */
const TONE = {
  ash: "text-muted-foreground",
  slate: "text-subtle-foreground",
  bone: "text-foreground",
  amp: "text-foreground",
  live: "text-green-text",
  alarm: "text-red-text",
  warn: "text-amber-text",
} as const;

/** The single most-used element in Watchman. Labels never compete with values. */
export function MonoLabel({
  children,
  className,
  tone = "ash",
}: {
  children: ReactNode;
  className?: string;
  tone?: "ash" | "slate" | "bone" | "amp" | "live" | "alarm";
}) {
  return <span className={cn("signal type-label-xs", TONE[tone], className)}>{children}</span>;
}

/**
 * A labelled figure: the dashboard's unit of information. It is Minima's Stat
 * — label, value, and an optional line under it — without the card, because
 * a readout here sits inside an instrument panel that is already the card.
 */
export function Readout({
  label,
  value,
  hint,
  tone = "bone",
  className,
  size = "md",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "bone" | "amp" | "live" | "alarm" | "warn" | "slate";
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "type-heading",
    md: "type-title",
    lg: "type-title sm:type-display",
  } as const;
  return (
    <Stat className={cn("gap-inset rounded-none border-0 bg-transparent p-0", className)}>
      <StatLabel className="signal type-label-xs text-muted-foreground">{label}</StatLabel>
      <StatValue className={cn("font-semibold", sizes[size], TONE[tone])}>{value}</StatValue>
      {hint ? <p className="signal tabular-nums type-label-xs text-subtle-foreground">{hint}</p> : null}
    </Stat>
  );
}

/** A key and its value on a dotted leader, like a spec sheet. */
export function KeyValue({ k, children, mono = true }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <MonoLabel className="shrink-0">{k}</MonoLabel>
      <span aria-hidden className="min-w-4 flex-1 -translate-y-0.5 border-b border-dotted border-gray-hairline-strong" />
      {/* The value may be a URL, a file path or a list of events: it has to be
          allowed to shrink and wrap, or one long value widens the whole page. */}
      <span className={cn("min-w-0 text-right type-caption text-foreground [overflow-wrap:anywhere]", mono && "figure")}>
        {children}
      </span>
    </div>
  );
}

/** A shell prompt: the instrument speaking. */
export function Prompt({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-muted-foreground">
      <span className="text-subtle-foreground" aria-hidden>
        &gt;{" "}
      </span>
      {children}
    </span>
  );
}

/** Inline code. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "rounded-mark border border-border bg-muted px-1.5 py-0.5 font-mono type-caption-sm text-foreground",
        className,
      )}
    >
      {children}
    </code>
  );
}
