import { createCn } from "cn/config"

/**
 * `cn`, taught about Minima's utilities.
 *
 * Every class merger — this one, tailwind-merge, all of them — carries a
 * HARDCODED table of which utility belongs to which CSS property. A custom
 * utility it has not heard of is guessed at, and both ways of guessing wrong
 * are silent:
 *
 *   DROPPED. It gets filed under the wrong property and displaced by a class
 *   from that group. `text-body` was read as a colour and eaten by
 *   `text-muted-foreground`. (Minima's type scale is `type-*` partly to avoid
 *   this shape entirely.)
 *
 *   NOT DISPLACING. It gets its own private group, so it never collapses with
 *   the stock class it is meant to replace and BOTH survive. The cascade then
 *   picks by stylesheet order rather than by what the author wrote — which is
 *   how `rounded-lg rounded-control-xs` rendered at 10px instead of 8px, and
 *   how `<Button className="h-control-lg" />` silently did nothing.
 *
 * The second one is the reason this file has to exist. It cannot be fixed by
 * naming, because the whole point is that a Minima utility must live in the
 * SAME group as the stock utility it replaces.
 *
 * Registering the groups makes both deterministic: ours collapses with theirs,
 * the later class wins, and a consumer's `className` beats the component every
 * time instead of most of the time.
 *
 * scripts/audit-merge.mjs checks this list against the CSS, so a utility added
 * to the theme without being added here is a failure rather than a surprise.
 */

const TYPE = [
  "type-display",
  "type-title",
  "type-heading",
  "type-subheading",
  "type-lead",
  "type-body",
  "type-caption",
  "type-caption-sm",
  "type-field",
  "type-label",
  "type-label-sm",
  "type-label-xs",
]

const RADIUS = [
  "rounded-panel",
  "rounded-control",
  "rounded-chip",
  "rounded-mark",
  "rounded-control-xs",
  "rounded-control-sm",
  "rounded-control-md",
  "rounded-control-lg",
]

const DEPTH = ["shadow-flat", "shadow-raised", "shadow-overlay", "shadow-modal"]
const CONTROL = ["control-xs", "control-sm", "control-md", "control-lg"]
const SPACE = ["inset", "gutter", "stack", "section"]
const DURATION = [
  "duration-instant",
  "duration-quick",
  "duration-base",
  "duration-slow",
  "duration-base-exit",
  "duration-slow-exit",
]

/** `p` + [gutter] -> ["p-gutter"], for every prefix in a family. */
const family = (prefixes: string[], names: string[]) =>
  Object.fromEntries(prefixes.map((p) => [p, names.map((n) => `${p}-${n}`)]))

/* createCn rather than extendTailwindMerge: the latter returns the bare merge
   signature, which does not accept the function form of `className` that Base
   UI components pass. createCn returns the full CnFunction and typechecks
   against every component we ship. */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": TYPE,
      rounded: RADIUS,
      shadow: DEPTH,
      duration: DURATION,
      ...family(["h", "min-h", "max-h", "w", "min-w", "max-w", "size"], CONTROL),
      ...family(
        ["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml", "gap", "gap-x", "gap-y"],
        SPACE
      ),
    },
  },
})
