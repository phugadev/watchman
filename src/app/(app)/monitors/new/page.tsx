import type { Metadata } from "next";
import { SectionHeader } from "@/components/ui/frame";
import { MonitorForm } from "@/components/monitors/monitor-form";
import { requireUser } from "@/lib/auth/session";
import { listChannels } from "@/lib/queries";

export const metadata: Metadata = { title: "New monitor" };

export default async function NewMonitorPage() {
  await requireUser();
  const channels = listChannels();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <SectionHeader label="new monitor" />
        <h1 className="text-2xl font-semibold tracking-tight text-bone">
          Add something to watch
        </h1>
      </div>

      <MonitorForm
        channels={channels.map(({ channel }) => ({
          id: channel.id,
          name: channel.name,
          kind: channel.kind,
        }))}
        // A new monitor with no channel is the most common way a self-hosted setup
        // ends up recording outages nobody hears about, so pre-select everything.
        attachedChannelIds={channels.map(({ channel }) => channel.id)}
      />
    </div>
  );
}
