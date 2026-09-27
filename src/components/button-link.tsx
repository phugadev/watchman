import Link from "next/link";
import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { buttonVariants } from "./ui/button";

/**
 * A link that looks like Minima's button. Minima's Button renders a <button>;
 * navigation wants a real anchor, so this puts the same classes on next/link.
 * Through cn, so a caller's className wins over the variant's.
 */
export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
