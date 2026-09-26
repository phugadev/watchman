import type { Metadata } from "next";
import Link from "next/link";
import { LinkTabs } from "@/components/link-tabs";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/button-link";
import {
  CropFrame,
  Panel,
  Rule,
  SectionHeader,
} from "@/components/ui/frame";
import { GradeBadge } from "@/components/ui/grade-badge";
import { Code, KeyValue, MonoLabel, Readout } from "@/components/ui/mono";
import { StatusPill, UptimeTape, UptimeTapeLegend } from "@/components/monitor-status";
import { TagList } from "@/components/ui/tag";
import { readTags } from "@/lib/monitors/tags";
import { LatencyChart } from "@/components/charts/latency-chart";
import { BudgetBar, GradeBreakdown } from "@/components/charts/budget-bar";
import { HeartbeatPanel } from "@/components/monitors/heartbeat-panel";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { GRADE_CAPTION } from "@/lib/metrics/grade";
import {
  WINDOWS,
  formatAgo,
  formatDuration,
  formatMs,
  formatUptime,
  type WindowKey,
} from "@/lib/metrics/uptime";
import {
  checkNowAction,
  deleteMonitorAction,
  togglePauseAction,
} from "@/lib/monitors/actions";
import { KIND_LABEL, parseExpectedRecords } from "@/lib/probe";
import { getMonitorDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Per-day text for the tape.
 *
 * "Degraded, 100% uptime" reads as a contradiction, even though both halves are true
 * under Watchman's model — a degraded check answered, it was just slow, so it counts as
 * available. Naming the slow and failed checks explicitly resolves it, and is more useful
 * than a percentage on its own.
 */
function tapeDetail(d: {
  uptimePct: number | null;
  total: number;
  degradedCount: number;
  downCount: number;
}): string {
  if (d.uptimePct === null) return "no data";
  const parts = [`${formatUptime(d.uptimePct)} available`];
  if (d.downCount > 0)
    parts.push(`${d.downCount} failed ${d.downCount === 1 ? "check" : "checks"}`);
  if (d.degradedCount > 0)
    parts.push(`${d.degradedCount} slow ${d.degradedCount === 1 ? "check" : "checks"}`);
  return parts.join(", ");
}


export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const detail = getMonitorDetail((await params).id);
  return { title: detail?.monitor.name ?? "Monitor" };
}

const WINDOW_KEYS: WindowKey[] = ["1h", "24h", "7d", "30d"];

export default async function MonitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ w?: string }>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const { id } = await params;
  const { w } = await searchParams;

  const windowKey = (WINDOW_KEYS.includes(w as WindowKey) ? w : "24h") as WindowKey;
  const detail = getMonitorDetail(id, windowKey);
  if (!detail) notFound();

  const {
    monitor,
    status,
    series,
    summary,
    grade,
    gradeScore,
    gradeParts,
    incidents30d,
    budget,
    recentChecks,
    incidents,
    channels,
    escalationPolicy,
    dailyTape,
  } = detail;

  const openIncident = incidents.find((i) => i.status !== "resolved");

  return (
    <div className="flex flex-col gap-8">
      {/* ---- header ------------------------------------------------------ */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 signal type-label-xs text-subtle-foreground">
          <Link href="/monitors" className="hover:text-muted-foreground">
            monitors
          </Link>
          <span aria-hidden>/</span>
          <span className="text-muted-foreground">{KIND_LABEL[monitor.kind]}</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2.5">
            <h1 className="type-title font-semibold text-foreground sm:type-title">
              {monitor.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <StatusPill status={status} />
              {monitor.target ? (
                <a
                  href={monitor.kind === "http" ? monitor.target : undefined}
                  target={monitor.kind === "http" ? "_blank" : undefined}
                  rel="noreferrer noopener"
                  className="font-mono type-caption-sm text-muted-foreground hover:text-foreground"
                >
                  {monitor.target}
                </a>
              ) : null}
              <MonoLabel tone="slate">
                every {formatDuration(monitor.intervalSec * 1000)}
              </MonoLabel>
            </div>
            <TagList
              tags={readTags(monitor.tags)}
              hrefFor={(t) => `/monitors?tag=${encodeURIComponent(t)}`}
            />
            {monitor.description ? (
              <p className="max-w-xl type-caption text-muted-foreground">
                {monitor.description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <form action={checkNowAction}>
              <input type="hidden" name="id" value={monitor.id} />
              <Button type="submit" variant="outline" size="sm">
                check now
              </Button>
            </form>
            <form action={togglePauseAction}>
              <input type="hidden" name="id" value={monitor.id} />
              <Button type="submit" variant="outline" size="sm">
                {monitor.paused ? "resume" : "pause"}
              </Button>
            </form>
            <ButtonLink href={`/monitors/${monitor.id}/edit`} variant="outline" size="sm">
              edit
            </ButtonLink>
          </div>
        </div>
      </div>

      {/* ---- open incident banner --------------------------------------- */}
      {openIncident ? (
        <Link
          href={`/incidents/${openIncident.id}`}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-red-border bg-red-fill px-4 py-3 transition-colors hover:bg-red-fill-hover"
        >
          <MonoLabel tone="alarm">
            {openIncident.status === "acknowledged" ? "acknowledged" : "open incident"}
          </MonoLabel>
          <span className="min-w-0 flex-1 truncate type-caption text-foreground">
            {openIncident.cause ?? "Check failed"}
          </span>
          <span className="tabular-nums font-mono type-caption-sm text-red-text">
            {formatDuration(Date.now() - openIncident.startedAt.getTime())}
          </span>
        </Link>
      ) : null}

      {/* ---- grade + budget --------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <CropFrame hatch className="flex flex-col justify-between gap-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-wrap items-end gap-8">
              <Readout
                label={`uptime · ${windowKey}`}
                value={summary.total === 0 ? "—" : formatUptime(summary.uptimePct)}
                hint={`${summary.total} checks`}
                size="lg"
                tone={
                  summary.uptimePct >= 99.9
                    ? "bone"
                    : summary.uptimePct >= 99
                      ? "warn"
                      : "alarm"
                }
              />
              <Readout label="p50" value={formatMs(summary.p50Ms)} size="sm" />
              <Readout label="p95" value={formatMs(summary.p95Ms)} size="sm" />
              <Readout label="p99" value={formatMs(summary.p99Ms)} size="sm" />
            </div>

            <div className="flex flex-col items-center gap-2">
              <GradeBadge grade={grade} size="lg" />
              <MonoLabel tone="slate">{GRADE_CAPTION[grade]}</MonoLabel>
            </div>
          </div>

          <BudgetBar budget={budget} />
        </CropFrame>

        <Panel inset className="flex flex-col gap-4">
          <SectionHeader label="grade breakdown" />
          <Rule />
          <GradeBreakdown parts={gradeParts} score={gradeScore} />
          <Rule />
          <div className="flex flex-col">
            <KeyValue k="incidents 30d">{incidents30d}</KeyValue>
            <KeyValue k="last check">{formatAgo(monitor.lastCheckedAt)}</KeyValue>
            <KeyValue k="since change">
              {monitor.lastStatusChangedAt
                ? formatDuration(Date.now() - monitor.lastStatusChangedAt.getTime())
                : "—"}
            </KeyValue>
          </div>
        </Panel>
      </div>

      {/* ---- latency chart ---------------------------------------------- */}
      <LinkTabs
        label="response time"
        value={windowKey}
        items={WINDOW_KEYS.map((k) => ({ value: k, label: k, href: `/monitors/${monitor.id}?w=${k}` }))}
      >

        <Panel className="grid-paper p-4">
          <LatencyChart
            data={series}
            degradedMs={monitor.degradedMs}
            height={220}
          />
          {WINDOWS[windowKey] > WINDOWS["24h"] ? (
            <p className="mt-2 signal type-label-xs text-subtle-foreground">
              aggregated hourly · line is p95, band is min–max
            </p>
          ) : null}
        </Panel>
      </LinkTabs>

      {/* ---- 90 day tape ------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="90 days" />
        <Panel inset className="flex flex-col gap-3">
          <UptimeTape
            height={40}
            buckets={dailyTape.map((d) => ({
              status: d.status,
              label: new Date(d.day).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              }),
              detail: tapeDetail(d),
            }))}
          />
          <div className="flex justify-between signal type-label-xs text-subtle-foreground">
            <span>90 days ago</span>
            <span>today</span>
          </div>
          <UptimeTapeLegend className="pt-1" />
        </Panel>
      </section>

      {/* ---- config + heartbeat ------------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel inset className="flex flex-col gap-4">
          <SectionHeader label="configuration" />
          <Rule />
          <div className="flex flex-col">
            <KeyValue k="type">{KIND_LABEL[monitor.kind]}</KeyValue>
            {monitor.kind === "http" ? (
              <>
                <KeyValue k="method">{monitor.method}</KeyValue>
                <KeyValue k="accepts">{monitor.expectedStatus}</KeyValue>
                {monitor.keyword ? (
                  <KeyValue k={monitor.keywordMode === "absent" ? "must not have" : "must match"}>
                    {monitor.keyword}
                  </KeyValue>
                ) : null}
                <KeyValue k="redirects">
                  {monitor.followRedirects ? "follow" : "do not follow"}
                </KeyValue>
                <KeyValue k="verify tls">{monitor.verifyTls ? "yes" : "no"}</KeyValue>
              </>
            ) : null}
            {monitor.kind === "dns" ? (
              <>
                <KeyValue k="record">{monitor.dnsRecordType ?? "A"}</KeyValue>
                <KeyValue k="resolver">{monitor.dnsResolver ?? "system"}</KeyValue>
                <KeyValue k="expects">
                  {monitor.dnsExpected
                    ? `${monitor.dnsMatchMode === "exact" ? "exactly" : "at least"} ${parseExpectedRecords(monitor.dnsExpected).join(", ")}`
                    : "any answer"}
                </KeyValue>
              </>
            ) : null}
            <KeyValue k="interval">{formatDuration(monitor.intervalSec * 1000)}</KeyValue>
            {monitor.kind !== "heartbeat" ? (
              <KeyValue k="timeout">{formatMs(monitor.timeoutMs)}</KeyValue>
            ) : (
              <KeyValue k="grace">{formatDuration(monitor.graceSec * 1000)}</KeyValue>
            )}
            <KeyValue k="confirm fail">{monitor.confirmFailures} checks</KeyValue>
            <KeyValue k="confirm ok">{monitor.confirmRecoveries} checks</KeyValue>
            <KeyValue k="degraded above">
              {monitor.degradedMs ? formatMs(monitor.degradedMs) : "off"}
            </KeyValue>
            <KeyValue k="slo target">{monitor.sloTargetPct}%</KeyValue>
          </div>

          <Rule />
          <div className="flex flex-col gap-2">
            <MonoLabel>alert channels</MonoLabel>
            {channels.length === 0 ? (
              <p className="type-caption-sm text-amber-text">
                None attached — outages here will alert nobody.{" "}
                <Link href={`/monitors/${monitor.id}/edit`} className="underline">
                  Attach one
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {channels.map((c) => (
                  <Code key={c.id}>
                    {c.name}
                    <span className="text-muted-foreground"> · {c.kind}</span>
                  </Code>
                ))}
              </div>
            )}
          </div>

          {/* Whether an unanswered alert goes anywhere else is part of how this
              monitor is wired, so it belongs next to the channels rather than
              only on the page where policies are edited. */}
          <div className="flex flex-col gap-2">
            <MonoLabel>escalation</MonoLabel>
            {escalationPolicy ? (
              <div className="flex flex-wrap items-center gap-2">
                <Code>{escalationPolicy.name}</Code>
                <span className="type-caption-sm text-muted-foreground">
                  {escalationPolicy.stepCount} step
                  {escalationPolicy.stepCount === 1 ? "" : "s"}
                  {escalationPolicy.repeatSec
                    ? `, repeating every ${formatDuration(escalationPolicy.repeatSec * 1000)}`
                    : ""}
                </span>
              </div>
            ) : (
              <p className="type-caption-sm text-subtle-foreground">
                None — one alert, then silence until it recovers.
              </p>
            )}
          </div>

          <Rule />
          <div className="flex items-center justify-between gap-4">
            <MonoLabel tone="slate">badge for your readme</MonoLabel>
            <Code className="truncate">/api/badge/{monitor.id}</Code>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element --
              next/image cannot optimise a dynamically generated SVG, and routing this
              through the image pipeline would cache the very thing that must stay fresh. */}
          <img
            src={`/api/badge/${monitor.id}`}
            alt={`Uptime badge for ${monitor.name}`}
            width={150}
            height={20}
            className="self-start"
          />
        </Panel>

        {monitor.kind === "heartbeat" && monitor.heartbeatToken ? (
          <HeartbeatPanel
            monitorId={monitor.id}
            token={monitor.heartbeatToken}
            publicUrl={env.publicUrl}
            intervalSec={monitor.intervalSec}
            graceSec={monitor.graceSec}
            canRotate={isAdmin}
          />
        ) : (
          <Panel inset className="flex flex-col gap-4">
            <SectionHeader label="recent checks" />
            <Rule />
            <ol className="flex max-h-[26rem] flex-col overflow-y-auto font-mono type-caption-sm">
              {recentChecks.map((c) => (
                <li
                  key={c.id}
                  className="flex items-baseline gap-3 border-b border-border/50 py-1.5 last:border-0"
                >
                  <span className="shrink-0 tabular-nums text-subtle-foreground">
                    {c.at.toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                  <span
                    className={
                      c.status === "down"
                        ? "w-3 shrink-0 text-red-text"
                        : c.status === "degraded"
                          ? "w-3 shrink-0 text-amber-text"
                          : "w-3 shrink-0 text-green-text"
                    }
                    aria-hidden
                  >
                    {c.status === "down" ? "✕" : c.status === "degraded" ? "~" : "✓"}
                  </span>
                  <span className="shrink-0 tabular-nums w-16 text-muted-foreground">
                    {formatMs(c.latencyMs)}
                  </span>
                  {c.httpStatus ? (
                    <span className="shrink-0 tabular-nums text-subtle-foreground">{c.httpStatus}</span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-subtle-foreground">
                    {c.error ?? ""}
                  </span>
                </li>
              ))}
              {recentChecks.length === 0 ? (
                <li className="py-3 text-subtle-foreground">no checks recorded yet</li>
              ) : null}
            </ol>
          </Panel>
        )}
      </div>

      {/* ---- incident history -------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="incident history" />
        <Panel className="divide-y divide-border">
          {incidents.length === 0 ? (
            <p className="px-4 py-6 text-center signal type-label-sm text-subtle-foreground">
              no incidents recorded
            </p>
          ) : (
            incidents.map((i) => (
              <Link
                key={i.id}
                href={`/incidents/${i.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted"
              >
                <span
                  className={
                    i.status === "resolved"
                      ? "size-2 shrink-0 bg-green-mark"
                      : "size-2 shrink-0 bg-red-mark"
                  }
                  aria-hidden
                />
                <span className="shrink-0 tabular-nums font-mono type-caption-sm text-subtle-foreground">
                  {i.startedAt.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate type-caption-sm text-muted-foreground">
                  {i.cause ?? "Check failed"}
                </span>
                {i.flapping ? <MonoLabel tone="amp">flapping</MonoLabel> : null}
                <span className="shrink-0 tabular-nums font-mono type-caption-sm text-foreground">
                  {i.resolvedAt
                    ? formatDuration(i.resolvedAt.getTime() - i.startedAt.getTime())
                    : "ongoing"}
                </span>
              </Link>
            ))
          )}
        </Panel>
      </section>

      {/* ---- danger zone --------------------------------------------------
           Admin-only, and hidden rather than disabled for members: a button that
           silently refuses is worse than one that was never offered. */}
      {isAdmin ? (
        <section className="flex flex-col gap-3">
          <SectionHeader label="danger zone" />
          <Panel className="flex flex-wrap items-center justify-between gap-4 rounded-panel border-red-border px-4 py-3">
            <p className="type-caption-sm text-muted-foreground">
              Deleting this monitor also removes its checks, rollups, and incident
              history. There is no undo.
            </p>
            <form action={deleteMonitorAction}>
              <input type="hidden" name="id" value={monitor.id} />
              <Button type="submit" variant="destructive" size="sm">
                delete monitor
              </Button>
            </form>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
