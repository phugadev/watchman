import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * MonoLabel — the single most-used element in Watchman. Uppercase mono at 10–11px
 * with wide tracking. Labels never compete with values for attention.
 */
export function MonoLabel({
  children,
  className,
  tone = "ash",
}: {
  children: ReactNode;
  className?: string;
  tone?: "ash" | "slate" | "bone" | "amp" | "live" | "alarm";
}) {
  const tones = {
    ash: "text-ash",
    slate: "text-slate",
    bone: "text-bone",
    amp: "text-amp",
    live: "text-live",
    alarm: "text-alarm",
  } as const;
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase leading-none tracking-[0.18em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Readout — a labelled metric. The label whispers in mono caps, the value shouts
 * in tabular figures. `hint` carries units or comparison.
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
  const tones = {
    bone: "text-bone",
    amp: "text-amp",
    live: "text-live",
    alarm: "text-alarm",
    warn: "text-warn",
    slate: "text-slate",
  } as const;
  const sizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl sm:text-5xl",
  } as const;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <MonoLabel>{label}</MonoLabel>
      <div
        className={cn(
          "tnum font-semibold leading-none tracking-tight",
          sizes[size],
          tones[tone],
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-slate">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/**
 * KeyValue — a dotted leader row, like a technical spec sheet. The dotted fill
 * between key and value is what makes long lists scannable.
 */
export function KeyValue({
  k,
  children,
  mono = true,
}: {
  k: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <MonoLabel className="shrink-0">{k}</MonoLabel>
      <span
        aria-hidden
        className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-hairline"
      />
      <span
        className={cn(
          "shrink-0 text-right text-[13px] text-bone",
          mono && "tnum font-mono",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** A `> ` terminal prompt prefix. */
export function Prompt({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-ash">
      <span className="text-slate" aria-hidden>
        &gt;{" "}
      </span>
      {children}
    </span>
  );
}

/** Inline monospace code chip. */
export function Code({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code
      className={cn(
        "border border-hairline-soft bg-panel-2 px-1.5 py-0.5 font-mono text-[12px] text-bone",
        className,
      )}
    >
      {children}
    </code>
  );
}
