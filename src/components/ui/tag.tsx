import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * A monitor tag. Square, hairline, mono — a label, not a pill.
 *
 * Renders as a link when `href` is given so tags double as the filter control: clicking
 * one on a card is the fastest way to see everything like it.
 */
export function Tag({
  children,
  href,
  active = false,
  count,
  className,
}: {
  children: string;
  href?: string;
  active?: boolean;
  count?: number;
  className?: string;
}) {
  const base = cn(
    "inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.12em] transition-colors",
    active
      ? "border-amp bg-amp/10 text-amp"
      : "border-hairline-soft text-slate hover:border-hairline hover:text-ash",
    className,
  );

  const body = (
    <>
      {children}
      {count !== undefined ? (
        <span className={cn("tnum", active ? "text-amp/70" : "text-slate/70")}>
          {count}
        </span>
      ) : null}
    </>
  );

  if (!href) return <span className={base}>{body}</span>;

  return (
    <Link href={href} className={base}>
      {body}
    </Link>
  );
}

/** A row of tags, or nothing at all when there are none. */
export function TagList({
  tags,
  hrefFor,
  activeTag,
  className,
}: {
  tags: readonly string[];
  hrefFor?: (tag: string) => string;
  activeTag?: string | null;
  className?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tags.map((t) => (
        <Tag key={t} href={hrefFor?.(t)} active={t === activeTag}>
          {t}
        </Tag>
      ))}
    </div>
  );
}
