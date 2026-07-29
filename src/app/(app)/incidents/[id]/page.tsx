import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CropFrame, Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { KeyValue, MonoLabel, Readout } from "@/components/ui/mono";
import { Input } from "@/components/ui/field";
import { formatDuration, formatMs } from "@/lib/metrics/uptime";
import { KIND_LABEL } from "@/lib/probe";
import { getIncident } from "@/lib/queries";
import { requireUser } from "@/lib/auth/session";
import {
  acknowledgeAction,
  commentAction,
  resolveAction,
} from "@/lib/incidents/actions";
import type { INCIDENT_EVENT_KINDS } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const found = getIncident((await params).id);
  return {
    title: found ? `Incident — ${found.monitor.name}` : "Incident",
  };
}

type EventKind = (typeof INCIDENT_EVENT_KINDS)[number];

const EVENT_TONE: Record<EventKind, string> = {
  opened: "bg-alarm",
  acknowledged: "bg-amp",
  comment: "bg-info",
  escalated: "bg-alarm",
  flapping: "bg-amp",
  recovered: "bg-live",
  resolved: "bg-live",
  suppressed: "bg-violet",
  notified: "bg-info",
  notify_failed: "bg-alarm",
};

const EVENT_LABEL: Record<EventKind, string> = {
  opened: "Opened",
  acknowledged: "Acknowledged",
  comment: "Note",
  escalated: "Escalated",
  flapping: "Flapping detected",
  recovered: "Recovered",
  resolved: "Resolved",
  suppressed: "Alerts suppressed",
  notified: "Alert sent",
  notify_failed: "Alert failed",
};

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const found = getIncident(id);
  if (!found) notFound();

  const { incident, monitor, timeline, deliveries, checks } = found;
  const isOpen = incident.status !== "resolved";
  const duration = incident.resolvedAt
    ? incident.resolvedAt.getTime() - incident.startedAt.getTime()
    : Date.now() - incident.startedAt.getTime();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate">
          <Link href="/incidents" className="hover:text-ash">
            incidents
          </Link>
          <span aria-hidden>/</span>
          <Link href={`/monitors/${monitor.id}`} className="hover:text-ash">
            {monitor.name}
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-bone">
            {incident.cause ?? "Check failed"}
          </h1>

          <div className="flex items-center gap-3">
            {isOpen && !incident.acknowledgedAt ? (
              <form action={acknowledgeAction}>
                <input type="hidden" name="id" value={incident.id} />
                <Button type="submit" variant="solid" size="sm">
                  acknowledge
                </Button>
              </form>
            ) : null}
            {isOpen ? (
              <form action={resolveAction}>
                <input type="hidden" name="id" value={incident.id} />
                <Button type="submit" variant="ghost" size="sm">
                  resolve manually
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>

      <CropFrame
        hatch
        tone={isOpen ? "alarm" : "live"}
        className="flex flex-wrap items-end gap-8 p-6 sm:gap-12"
      >
        <Readout
          label="status"
          value={
            incident.status === "open"
              ? "Open"
              : incident.status === "acknowledged"
                ? "Acknowledged"
                : "Resolved"
          }
          tone={isOpen ? "alarm" : "live"}
          hint={KIND_LABEL[monitor.kind]}
        />
        <Readout
          label={incident.resolvedAt ? "lasted" : "ongoing for"}
          value={formatDuration(duration)}
          size="lg"
          tone={isOpen ? "alarm" : "bone"}
        />
        <Readout
          label="failed checks"
          value={incident.failedChecks}
          hint={`confirmed after ${monitor.confirmFailures}`}
        />
        {incident.flapping ? (
          <Readout
            label="stability"
            value="Flapping"
            tone="amp"
            hint="alerts suppressed"
            size="sm"
          />
        ) : null}
      </CropFrame>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---- timeline -------------------------------------------------- */}
        <section className="flex flex-col gap-3">
          <SectionHeader label="timeline" />
          <Panel inset>
            <ol className="flex flex-col">
              {timeline.map(({ event, actorName }, i) => (
                <li key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
                  {/* Connector between markers, stopped short of the last one. */}
                  {i < timeline.length - 1 ? (
                    <span
                      aria-hidden
                      className="absolute left-[3px] top-3 h-full w-px bg-hairline-soft"
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={`relative mt-1.5 size-[7px] shrink-0 ${EVENT_TONE[event.kind]}`}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <MonoLabel tone="bone">{EVENT_LABEL[event.kind]}</MonoLabel>
                      <span className="tnum font-mono text-[10px] text-slate">
                        {event.at.toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      {actorName ? (
                        <span className="font-mono text-[10px] text-slate">
                          {actorName}
                        </span>
                      ) : null}
                    </div>
                    {event.message ? (
                      <p className="break-words text-[13px] leading-relaxed text-ash">
                        {event.message}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <Rule className="my-4" />

            <form action={commentAction} className="flex items-center gap-3">
              <input type="hidden" name="id" value={incident.id} />
              <Input
                name="message"
                placeholder="Add a note to the timeline…"
                maxLength={2000}
                className="flex-1"
              />
              <Button type="submit" variant="ghost" size="sm">
                add
              </Button>
            </form>
          </Panel>
        </section>

        {/* ---- context --------------------------------------------------- */}
        <div className="flex flex-col gap-4">
          <Panel inset className="flex flex-col gap-3">
            <SectionHeader label="monitor" />
            <Rule />
            <div className="flex flex-col">
              <KeyValue k="name">
                <Link href={`/monitors/${monitor.id}`} className="hover:text-amp">
                  {monitor.name}
                </Link>
              </KeyValue>
              <KeyValue k="type">{KIND_LABEL[monitor.kind]}</KeyValue>
              {monitor.target ? (
                <KeyValue k="target">
                  <span className="break-all">{monitor.target}</span>
                </KeyValue>
              ) : null}
              <KeyValue k="interval">
                {formatDuration(monitor.intervalSec * 1000)}
              </KeyValue>
              <KeyValue k="started">
                {incident.startedAt.toLocaleString()}
              </KeyValue>
              {incident.resolvedAt ? (
                <KeyValue k="resolved">
                  {incident.resolvedAt.toLocaleString()}
                </KeyValue>
              ) : null}
            </div>
          </Panel>

          {/* The delivery log answers the question people actually ask after an
              outage: was anyone told, and did it get through? */}
          <Panel inset className="flex flex-col gap-3">
            <SectionHeader label="alert deliveries" />
            <Rule />
            {deliveries.length === 0 ? (
              <p className="text-[12px] text-slate">
                {incident.suppressed
                  ? "Suppressed by a maintenance window."
                  : "No alerts were sent for this incident."}
              </p>
            ) : (
              <ol className="flex flex-col gap-2 font-mono text-[11px]">
                {deliveries.map(({ notification, channelName }) => (
                  <li key={notification.id} className="flex items-baseline gap-2">
                    <span
                      className={
                        notification.ok
                          ? "size-1.5 shrink-0 bg-live"
                          : "size-1.5 shrink-0 bg-alarm"
                      }
                      aria-hidden
                    />
                    <span className="shrink-0 text-ash">{channelName}</span>
                    <span className="text-slate">{notification.kind}</span>
                    {notification.attempts > 1 ? (
                      <span className="text-warn">×{notification.attempts}</span>
                    ) : null}
                    <span className="ml-auto shrink-0 tnum text-slate">
                      {formatMs(notification.durationMs)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {deliveries.some((d) => !d.notification.ok) ? (
              <p className="border-l-2 border-alarm/40 pl-2 font-mono text-[10px] text-alarm">
                {deliveries.find((d) => !d.notification.ok)!.notification.error}
              </p>
            ) : null}
          </Panel>
        </div>
      </div>

      {/* ---- checks around the incident -------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="checks around this incident" />
        <Panel inset>
          <ol className="flex max-h-72 flex-col overflow-y-auto font-mono text-[11px]">
            {checks.map((c) => (
              <li
                key={c.id}
                className="flex items-baseline gap-3 border-b border-hairline-soft/50 py-1.5 last:border-0"
              >
                <span className="shrink-0 tnum text-slate">
                  {c.at.toLocaleTimeString(undefined, { hour12: false })}
                </span>
                <span
                  className={
                    c.status === "down"
                      ? "w-3 shrink-0 text-alarm"
                      : c.status === "degraded"
                        ? "w-3 shrink-0 text-warn"
                        : "w-3 shrink-0 text-live"
                  }
                  aria-hidden
                >
                  {c.status === "down" ? "✕" : c.status === "degraded" ? "~" : "✓"}
                </span>
                <span className="w-16 shrink-0 tnum text-ash">
                  {formatMs(c.latencyMs)}
                </span>
                {c.httpStatus ? (
                  <span className="w-8 shrink-0 tnum text-slate">{c.httpStatus}</span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-slate">
                  {c.error ?? ""}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </section>
    </div>
  );
}
