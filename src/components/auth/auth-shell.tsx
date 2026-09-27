import type { ReactNode } from "react";
import { CropFrame } from "@/components/ui/frame";
import { Mark } from "@/components/ui/logo";
import { MonoLabel } from "@/components/ui/mono";

/**
 * The frame around every unauthenticated page. A single centred instrument panel
 * on a hatched field — no marketing, no illustration. The tool announces what it
 * is and asks for credentials.
 */
export function AuthShell({
  eyebrow,
  title,
  intro,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-12">
      {/* Ambient field: graph paper, with a soft vignette so the centre reads. */}
      <div aria-hidden className="grid-paper absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 42%, transparent, var(--background) 78%)",
        }}
      />

      <div className="relative w-full max-w-[26rem]">
        <div className="mb-7 flex items-center gap-2.5">
          <Mark size={22} className="text-foreground" />
          <span className="font-sans type-subheading font-semibold text-foreground">
            Watchman
          </span>
        </div>

        <CropFrame className="bg-card p-7" size={12}>
          <MonoLabel tone="amp">{eyebrow}</MonoLabel>
          <h1 className="mt-3 type-title font-semibold text-foreground">
            {title}
          </h1>
          {intro ? (
            <p className="mt-2.5 type-caption text-muted-foreground">{intro}</p>
          ) : null}
          <div className="mt-7">{children}</div>
        </CropFrame>

        {footer ? (
          <div className="mt-5 text-center type-caption-sm text-subtle-foreground">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}
