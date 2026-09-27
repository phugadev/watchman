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
  /* A Minima chip. Active is the inverted neutral — emphasis, not a hue,
     because a hue on this surface means a state. */
  const base = cn(
    "signal inline-flex items-center gap-1.5 rounded-chip border px-2 py-0.5 type-label-xs transition-colors duration-quick",
    active
      ? "border-transparent bg-primary text-primary-foreground"
      : "border-border text-subtle-foreground hover:border-gray-hairline-strong hover:text-muted-foreground",
    className,
  );
  const body = (
    <>
      {children}
      {count !== undefined ? (
        <span className={cn("tabular-nums", active ? "opacity-70" : "text-subtle-foreground")}>
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
