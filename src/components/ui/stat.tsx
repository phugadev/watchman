import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/cn"

/**
 * Stat — a single measurement.
 *
 * This is a recipe, not a re-styled shadcn component: nothing upstream carries
 * it, and it is where Minima's identity is supposed to live if it lives
 * anywhere. Three decisions make it Minima's rather than generic:
 *
 *   1. The value uses the `figure` register — mono and tabular. A figure is read
 *      by comparing it to the figure above it, and proportional digits make a
 *      column of numbers ragged.
 *   2. The tile is a filled solid — the `solid` role with the computed
 *      on-solid glyph, in both modes, so a hue stays recognisable. Amber is a
 *      bright colour; any attempt to darken it for page contrast turns it to
 *      gold. Neutral remains available and is right for a measurement that is
 *      simply a number rather than a state.
 *   3. The delta is the only coloured text, and its colour reports direction,
 *      not decoration. Everything else on the card is neutral.
 *
 * The tone is deliberately not "brand" or "accent". A stat's colour should say
 * what kind of measurement it is, or nothing at all — neutral is the default
 * and most stats should keep it.
 */

const tileVariants = cva(
  "inline-flex size-7 shrink-0 items-center justify-center rounded-mark [&>svg]:size-3.5",
  {
    variants: {
      /**
       * Step 9 — the solid — with the glyph on the generator's computed
       * `on-solid`. Step 9 in BOTH modes, which is what keeps a hue looking
       * like itself: amber's solid is bright, so a light-mode amber tile is
       * bright amber with a dark glyph, not the dark gold you get if you drop
       * to a lower step chasing contrast against the page.
       *
       * The tile does not need 3:1 against the page. It is a container, not a
       * mark — the label beside it carries the meaning and the glyph inside it
       * is legible by construction. That floor belongs on things that convey
       * state alone, like a status dot.
       */
      tone: {
        neutral: "bg-gray-fill text-gray-text",
        info: "bg-blue-solid text-blue-on-solid",
        success: "bg-green-solid text-green-on-solid",
        warning: "bg-amber-solid text-amber-on-solid",
        danger: "bg-red-solid text-red-on-solid",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

function Stat({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat"
      className={cn(
        "flex flex-col gap-gutter rounded-panel border border-border bg-card p-gutter",
        className
      )}
      {...props}
    />
  )
}

function StatIcon({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof tileVariants>) {
  return (
    <span
      data-slot="stat-icon"
      className={cn(tileVariants({ tone }), className)}
      {...props}
    />
  )
}

function StatLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="stat-label"
      className={cn("type-caption text-muted-foreground", className)}
      {...props}
    />
  )
}

function StatValue({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="stat-value"
      className={cn(
        "figure type-title leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

/**
 * Direction is a property of the number, not of whether it is good news.
 * A rising error rate and a rising revenue both point up; whether that is
 * welcome is the product's business, so `intent` is separate and optional.
 */
function StatDelta({
  className,
  direction,
  intent = "neutral",
  children,
  ...props
}: React.ComponentProps<"span"> & {
  direction: "up" | "down"
  intent?: "neutral" | "positive" | "negative"
}) {
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight
  return (
    <span
      data-slot="stat-delta"
      data-direction={direction}
      className={cn(
        "figure inline-flex items-center gap-1 type-caption",
        intent === "neutral" && "text-muted-foreground",
        intent === "positive" && "text-green-text",
        intent === "negative" && "text-red-text",
        className
      )}
      {...props}
    >
      <Icon className="size-3" />
      {children}
    </span>
  )
}

export { Stat, StatIcon, StatLabel, StatValue, StatDelta, tileVariants }
