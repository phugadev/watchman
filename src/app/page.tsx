import { Wordmark } from "@/components/ui/logo";
import { CropFrame } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import { GradeBadge } from "@/components/ui/grade-badge";
import { StatusPill, UptimeTape } from "@/components/ui/status";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <Wordmark />
      <CropFrame className="mt-10 p-10" hatch>
        <MonoLabel>overall grade</MonoLabel>
        <div className="mt-6 flex items-end justify-between gap-8">
          <h1 className="font-mono text-4xl tracking-tight text-bone">
            watchman.dev
          </h1>
          <GradeBadge grade="S" size="xl" />
        </div>
      </CropFrame>
      <div className="mt-8 flex gap-6">
        <StatusPill status="up" />
        <StatusPill status="degraded" />
        <StatusPill status="down" />
      </div>
      <UptimeTape
        className="mt-8"
        buckets={Array.from({ length: 90 }, (_, i) => ({
          label: `day ${i}`,
          status: i === 40 ? ("down" as const) : i === 55 ? ("degraded" as const) : ("up" as const),
        }))}
      />
    </main>
  );
}
