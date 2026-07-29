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
            "radial-gradient(ellipse 70% 60% at 50% 42%, transparent, var(--color-void) 78%)",
        }}
      />

      <div className="relative w-full max-w-[26rem]">
        <div className="mb-7 flex items-center gap-2.5">
          <Mark size={22} className="text-bone" />
          <span className="font-sans text-[15px] font-semibold tracking-tight text-bone">
            Watchman
          </span>
        </div>

        <CropFrame className="bg-panel p-7" size={12}>
          <MonoLabel tone="amp">{eyebrow}</MonoLabel>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-bone">
            {title}
          </h1>
          {intro ? (
            <p className="mt-2.5 text-[13px] leading-relaxed text-ash">{intro}</p>
          ) : null}
          <div className="mt-7">{children}</div>
        </CropFrame>

        {footer ? (
          <div className="mt-5 text-center text-[12px] text-slate">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}
