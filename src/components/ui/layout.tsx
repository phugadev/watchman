import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/cn"

/* ---------------------------------------------------------------------------
   Layout — the page, its regions, and the voice that names them.

   Four primitives, extracted from the first site built on Minima rather than
   designed ahead of one. Every gap is a rung of the space ladder, so the whole
   page follows density: a root with data-density="comfortable" loosens these
   exactly as it loosens everything else.

     Container   the page column. Text inside it sets its own measure.
     Eyebrow     the signal voice — mono, uppercase, tracked. Scanned, never
                 read, so it names things and never says a sentence.
     Section     a region: one section rung ABOVE it, only above, so two
                 regions sit one rung apart rather than two; and a header row
                 naming it, with room for one aside — a count, a link.
     PageHeader  the top of an index page: eyebrow, title, one lead paragraph,
                 and a slot for what comes before the list (filters).

   Every className goes through cn. A primitive whose defaults a consumer
   cannot override is a primitive they stop using: appending `hidden` to a
   class list that already carries `inline-flex` loses to stylesheet order
   without a merge, and that exact bug shipped in the first consumer.
--------------------------------------------------------------------------- */

const containerVariants = cva("mx-auto w-full px-gutter sm:px-stack", {
  variants: {
    size: {
      /* Wide enough for a two-column grid of panels at a desktop width. */
      page: "max-w-5xl",
    },
  },
  defaultVariants: { size: "page" },
})

type ContainerProps = React.ComponentProps<"div"> &
  VariantProps<typeof containerVariants> & {
    as?: "div" | "section" | "header" | "footer" | "article" | "main"
  }

function Container({ className, size, as: Tag = "div", ...props }: ContainerProps) {
  return <Tag data-slot="container" className={cn(containerVariants({ size }), className)} {...props} />
}

type EyebrowProps = React.ComponentProps<"p"> & {
  as?: "p" | "span" | "h2" | "h3"
}

function Eyebrow({ className, as: Tag = "p", ...props }: EyebrowProps) {
  return (
    <Tag
      data-slot="eyebrow"
      className={cn("signal flex items-center gap-2 type-label-sm text-subtle-foreground", className)}
      {...props}
    />
  )
}

type SectionProps = Omit<React.ComponentProps<"section">, "children"> & {
  label: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}

function Section({ className, label, aside, children, ...props }: SectionProps) {
  return (
    <section data-slot="section" className={cn(containerVariants(), "pt-section", className)} {...props}>
      <div className="mb-stack flex items-center justify-between gap-gutter border-b border-border pb-gutter">
        <Eyebrow as="h2" className="text-foreground">
          {label}
        </Eyebrow>
        {aside ? <div className="signal type-label-sm text-subtle-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

type PageHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  lead?: React.ReactNode
}

function PageHeader({ className, eyebrow, title, lead, children, ...props }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn(containerVariants(), "pt-section pb-stack", className)} {...props}>
      {eyebrow}
      <h1 className="mt-gutter max-w-3xl text-balance type-title text-foreground sm:type-display">{title}</h1>
      {lead ? <p className="mt-gutter max-w-2xl text-pretty type-lead text-muted-foreground">{lead}</p> : null}
      {children ? <div className="mt-stack">{children}</div> : null}
    </header>
  )
}

export { Container, containerVariants, Eyebrow, Section, PageHeader }
