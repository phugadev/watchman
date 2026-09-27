import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding type-body font-medium whitespace-nowrap transition-all select-none active:not-aria-[haspopup]:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // A control you operate should read as an OBJECT, not as a slightly
        // different grey. bg-background made this the page colour exactly;
        // the raised surface plus a hairline plus the raised shadow is the
        // same rung a card sits on, and it is what light mode has instead of
        // room to lighten further.
        outline:
          "border-gray-hairline-strong bg-surface-raised shadow-raised hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-gray-tint-active aria-expanded:bg-gray-tint-active aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
        // An arbitrary /10 of the SOLID step, with the solid step as its text.
        // That pairing is not one the ramps guarantee, and it measured 4.31:1
        // in light and 3.33:1 in dark. The ramp already has a checked answer
        // for tinted-ground-plus-text — fill behind text, which is the pairing
        // audit-ramps verifies for every hue — so use that.
        //
        // Opaque fill, NOT the tint. The tint reproduces the fill over paper or
        // ink and drifts on anything else: this button sits on a card, where
        // red-tint composites lighter than red-3 and the pairing fell to 4.3:1.
        // A guarantee measured against the opaque step does not travel with its
        // translucent twin — see audit-alpha's ground check.
        destructive:
          "bg-red-fill text-red-text hover:bg-red-fill-hover",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-control-md gap-1.5 rounded-control-md px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-control-xs gap-1 rounded-control-xs px-2 type-caption-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-control-sm gap-1 rounded-control-sm px-2.5 type-caption in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-control-lg gap-1.5 rounded-control-lg px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-control-md rounded-control-md",
        "icon-xs":
          "size-control-xs rounded-control-xs in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-control-sm rounded-control-sm in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-control-lg rounded-control-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
