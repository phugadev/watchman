import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitorChannels } from "@/lib/db/schema";
import { SectionHeader } from "@/components/ui/frame";
import { MonitorForm } from "@/components/monitors/monitor-form";
import { requireUser } from "@/lib/auth/session";
import { getMonitor, listChannels, listEscalationPolicies } from "@/lib/queries";

export const metadata: Metadata = { title: "Edit monitor" };

export default async function EditMonitorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const monitor = getMonitor(id);
  if (!monitor) notFound();

  const channels = listChannels();
  const attached = db
    .select({ channelId: monitorChannels.channelId })
    .from(monitorChannels)
    .where(eq(monitorChannels.monitorId, id))
    .all()
    .map((r) => r.channelId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <SectionHeader label="edit monitor" />
        <h1 className="text-2xl font-semibold tracking-tight text-bone">
          {monitor.name}
        </h1>
      </div>

      <MonitorForm
        monitor={monitor}
        channels={channels.map(({ channel }) => ({
          id: channel.id,
          name: channel.name,
          kind: channel.kind,
        }))}
        attachedChannelIds={attached}
        escalationPolicies={listEscalationPolicies().map(({ policy }) => ({
          id: policy.id,
          name: policy.name,
        }))}
      />
    </div>
  );
}
