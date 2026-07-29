import type { Metadata } from "next";
import Link from "next/link";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { Code, KeyValue, MonoLabel } from "@/components/ui/mono";
import { ChangePasswordForm } from "@/components/auth/change-password";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatAgo, formatDuration } from "@/lib/metrics/uptime";
import { schedulerStatus } from "@/lib/scheduler";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const scheduler = schedulerStatus();

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <SectionHeader label="settings" />

      <Panel inset className="flex flex-col gap-4">
        <SectionHeader label="your account" />
        <Rule />
        <div className="flex flex-col">
          <KeyValue k="name" mono={false}>
            {user.name}
          </KeyValue>
          <KeyValue k="email">{user.email}</KeyValue>
          <KeyValue k="role">{user.role}</KeyValue>
          <KeyValue k="member since">
            {user.createdAt.toLocaleDateString()}
          </KeyValue>
        </div>
        {user.role === "admin" ? (
          <p className="text-[12px] text-ash">
            You are an administrator.{" "}
            <Link href="/team" className="text-amp hover:underline">
              Manage the team
            </Link>
            .
          </p>
        ) : null}
      </Panel>

      <Panel inset className="flex flex-col gap-4">
        <SectionHeader label="change password" />
        <Rule />
        <ChangePasswordForm />
      </Panel>

      <Panel inset className="flex flex-col gap-4">
        <SectionHeader label="scheduler" />
        <Rule />
        <div className="flex flex-col">
          <KeyValue k="state">
            <span className={scheduler.running ? "text-live" : "text-alarm"}>
              {scheduler.running ? "running" : "stopped"}
            </span>
          </KeyValue>
          <KeyValue k="uptime">{formatDuration(scheduler.uptimeMs)}</KeyValue>
          <KeyValue k="ticks">{scheduler.ticks}</KeyValue>
          <KeyValue k="in flight">{scheduler.inFlight}</KeyValue>
          <KeyValue k="tick interval">{formatDuration(scheduler.tickMs)}</KeyValue>
          <KeyValue k="max concurrent">{scheduler.maxConcurrent}</KeyValue>
          <KeyValue k="last check">
            {formatAgo(scheduler.lastCheckAt ? new Date(scheduler.lastCheckAt) : null)}
          </KeyValue>
        </div>
      </Panel>

      {/* Configuration is environment-driven rather than editable here on purpose:
          a self-hosted deployment should be reproducible from its compose file, not
          from state someone clicked into a database. */}
      <Panel inset className="flex flex-col gap-4">
        <SectionHeader label="instance configuration" />
        <Rule />
        <p className="text-[12px] leading-relaxed text-ash">
          These come from the environment, so a deployment is fully described by its
          compose file rather than by settings someone clicked in. Change them there
          and restart.
        </p>
        <div className="flex flex-col">
          <KeyValue k="public url">{env.publicUrl}</KeyValue>
          <KeyValue k="database">{env.dbPath}</KeyValue>
          <KeyValue k="raw retention">{env.rawRetentionDays} days</KeyValue>
          <KeyValue k="hourly rollups">{env.hourlyRetentionDays} days</KeyValue>
          <KeyValue k="daily rollups">{env.dailyRetentionDays} days</KeyValue>
          <KeyValue k="session ttl">{env.sessionTtlDays} days</KeyValue>
          <KeyValue k="invite ttl">{env.inviteTtlHours} hours</KeyValue>
        </div>
        <Rule />
        <div className="flex flex-col gap-2">
          <MonoLabel tone="slate">health endpoint</MonoLabel>
          <Code>GET {env.publicUrl}/api/health</Code>
          <p className="text-[11px] leading-relaxed text-slate">
            Returns 503 when the database is unreachable or the probe loop has
            stalled, so an orchestrator restarts a container that is serving pages
            but no longer monitoring anything.
          </p>
        </div>
      </Panel>
    </div>
  );
}
