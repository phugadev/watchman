import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/cn"

/**
 * Status — a state, as a chip.
 *
 * The second recipe, and a better demonstration of the ramps than Stat was,
 * because a chip needs three colours off one hue at once and each comes from a
 * different rung:
 *
 *   fill    the tinted ground
 *   border  so the chip holds its edge on any surface
 *   solid   the dot. The dot never appears without its label, so it is not
 *           carrying the state alone and does not owe the page 3:1 — dropping
 *           it to a darker step for contrast turned amber into mustard.
 *   text    the label
 *
 * That is the whole argument for generating ramps on Radix semantics rather
 * than picking colours. "Ground, border, mark, text" is one rule written once,
 * and it holds for every hue without anybody choosing twenty values.
 *
 * The shape is a pill, always. Charter-wise it is the chip rung: a pill says
 * "this is a marker, scan it" and distinguishes state from the square-cornered
 * controls you operate. It is the one place a full radius is correct.
 *
 * The dot is optional and worth using when the chip sits in a dense column —
 * it gives the eye something to catch at small sizes, and it carries the state
 * even when the label is truncated.
 */

const statusVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-chip border px-2 py-0.5 type-caption font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-gray-border bg-gray-fill text-gray-text",
        info: "border-blue-border bg-blue-fill text-blue-text",
        success: "border-green-border bg-green-fill text-green-text",
        warning: "border-amber-border bg-amber-fill text-amber-text",
        danger: "border-red-border bg-red-fill text-red-text",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

const dotVariants = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-gray-solid",
      info: "bg-blue-solid",
      success: "bg-green-solid",
      warning: "bg-amber-solid",
      danger: "bg-red-solid",
    },
  },
  defaultVariants: { tone: "neutral" },
})

function Status({
  className,
  tone,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof statusVariants> & { dot?: boolean }) {
  return (
    <span
      data-slot="status"
      data-tone={tone ?? "neutral"}
      className={cn(statusVariants({ tone }), className)}
      {...props}
    >
      {dot ? <span data-slot="status-dot" className={dotVariants({ tone })} /> : null}
      {children}
    </span>
  )
}

export { Status, statusVariants, dotVariants }
