"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "solid" | "bracket" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-mono uppercase tracking-[0.14em] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40";

const variants: Record<Variant, string> = {
  // The primary CTA: solid amp yellow with void-coloured text.
  solid: "bg-amp text-void hover:bg-amp/85 font-semibold",
  // The workhorse secondary: reads as `[ LABEL ]` via ::before/::after brackets.
  bracket:
    "text-ash hover:text-bone before:content-['['] after:content-[']'] before:text-slate after:text-slate before:mr-1 after:ml-1 hover:before:text-amp hover:after:text-amp",
  ghost:
    "border border-hairline-soft text-ash hover:border-hairline hover:text-bone hover:bg-panel-2",
  danger:
    "border border-alarm/40 text-alarm hover:bg-alarm/10 hover:border-alarm",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[10px]",
  md: "h-9 px-4 text-[11px]",
};

// `bracket` renders its own brackets, so it must not carry a box or padding.
const bracketOverride = "h-auto px-0";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        base,
        variants[variant],
        sizes[size],
        variant === "bracket" && bracketOverride,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link
      href={href}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        variant === "bracket" && bracketOverride,
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
