"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface NavItem {
  href: string;
  label: string;
  /** Rendered as an amp-yellow count chip — used for open incidents. */
  badge?: number;
  adminOnly?: boolean;
}

export function NavLinks({
  items,
  className,
}: {
  items: NavItem[];
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-nowrap items-center gap-1", className)}>
      {items.map((item) => {
        // Prefix match so /monitors/abc keeps "Monitors" lit, but never let "/"
        // match everything.
        const active =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // whitespace-nowrap is load-bearing: without it the count chip wraps
              // below its label and pushes the fixed-height header out of shape.
              "relative shrink-0 whitespace-nowrap px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-150",
              active ? "text-bone" : "text-slate hover:text-ash",
            )}
          >
            {item.label}
            {item.badge ? (
              <span className="ml-1.5 inline-flex min-w-4 justify-center bg-alarm px-1 py-px tnum text-[9px] font-semibold text-bone">
                {item.badge}
              </span>
            ) : null}
            {/* The active marker is a solid underline flush with the header's
                bottom border — the tab metaphor, without a tab. */}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-px bg-amp"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
