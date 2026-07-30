import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, Panel, SectionHeader } from "@/components/ui/frame";
import { GradeBadge } from "@/components/ui/grade-badge";
import { MonoLabel } from "@/components/ui/mono";
import { StatusDot } from "@/components/ui/status";
import { Tag, TagList } from "@/components/ui/tag";
import { collectTags, parseTags, readTags } from "@/lib/monitors/tags";
import { KIND_LABEL } from "@/lib/probe";
import { formatAgo, formatMs, formatUptime } from "@/lib/metrics/uptime";
import { listMonitorsWithHealth } from "@/lib/queries";

export const metadata: Metadata = { title: "Monitors" };
export const dynamic = "force-dynamic";

/**
 * The dense table view. The dashboard's card grid is for scanning state; this is
 * for comparing numbers down a column, which cards make impossible.
 */
export default async function MonitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const all = listMonitorsWithHealth(24);
  const { tag } = await searchParams;

  // Normalised the same way tags are stored, so a hand-typed ?tag=Prod still matches.
  const activeTag = tag ? parseTags(tag)[0] ?? null : null;
  const tagCounts = collectTags(all.map((h) => h.monitor));
  const health = activeTag
    ? all.filter((h) => readTags(h.monitor.tags).includes(activeTag))
    : all;

  if (all.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHeader label="monitors" />
        <EmptyState
          title="no monitors"
          hint="Watchman can watch HTTP endpoints, TCP ports, TLS certificates, ICMP reachability, and cron jobs that phone home."
          action={
            <ButtonLink href="/monitors/new" variant="solid">
              Create a monitor
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        label={
          activeTag
            ? `monitors · ${health.length} of ${all.length}`
            : `monitors · ${all.length}`
        }
      >
        <ButtonLink href="/monitors/new" variant="solid" size="sm">
          new monitor
        </ButtonLink>
      </SectionHeader>

      {/* Only worth the row once tags actually exist — an empty filter bar is furniture. */}
      {tagCounts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag href="/monitors" active={activeTag === null}>
            all
          </Tag>
          {tagCounts.map(({ tag: t, count }) => (
            <Tag
              key={t}
              href={
                t === activeTag ? "/monitors" : `/monitors?tag=${encodeURIComponent(t)}`
              }
              active={t === activeTag}
              count={count}
            >
              {t}
            </Tag>
          ))}
        </div>
      ) : null}

      {activeTag && health.length === 0 ? (
        <EmptyState
          title={`no monitors tagged "${activeTag}"`}
          hint="The tag may have been renamed or removed since this link was shared."
          action={
            <ButtonLink href="/monitors" variant="ghost" size="sm">
              Show all monitors
            </ButtonLink>
          }
        />
      ) : null}

      {health.length > 0 ? (
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline-soft">
              {["", "monitor", "type", "24h", "p95", "incidents 30d", "last check", "grade"].map(
                (h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2.5 font-mono text-[9px] font-normal uppercase tracking-[0.16em] text-slate"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {health.map(({ monitor, status, summary24h, grade, incidents30d }) => (
              <tr
                key={monitor.id}
                className="border-b border-hairline-soft/60 transition-colors last:border-0 hover:bg-panel-2"
              >
                <td className="w-6 px-3 py-3">
                  <StatusDot status={status} beacon />
                </td>
                <td className="max-w-[18rem] px-3 py-3">
                  <Link href={`/monitors/${monitor.id}`} className="group block">
                    <div className="truncate text-[13px] text-bone group-hover:text-amp">
                      {monitor.name}
                    </div>
                    <div className="truncate font-mono text-[10px] text-slate">
                      {monitor.kind === "heartbeat"
                        ? `expects a ping every ${monitor.intervalSec}s`
                        : monitor.target.replace(/^https?:\/\//, "")}
                    </div>
                  </Link>
                  <TagList
                    className="mt-1.5"
                    tags={readTags(monitor.tags)}
                    activeTag={activeTag}
                    hrefFor={(t) => `/monitors?tag=${encodeURIComponent(t)}`}
                  />
                </td>
                <td className="px-3 py-3">
                  <MonoLabel tone="ash">{KIND_LABEL[monitor.kind]}</MonoLabel>
                </td>
                <td className="px-3 py-3 tnum font-mono text-[12px] text-bone">
                  {summary24h.total === 0 ? "—" : formatUptime(summary24h.uptimePct)}
                </td>
                <td className="px-3 py-3 tnum font-mono text-[12px] text-ash">
                  {formatMs(summary24h.p95Ms)}
                </td>
                <td className="px-3 py-3 tnum font-mono text-[12px]">
                  <span className={incidents30d > 0 ? "text-warn" : "text-slate"}>
                    {incidents30d}
                  </span>
                </td>
                <td className="px-3 py-3 tnum font-mono text-[11px] text-slate">
                  {monitor.paused ? "paused" : formatAgo(monitor.lastCheckedAt)}
                </td>
                <td className="px-3 py-3">
                  <GradeBadge grade={grade} size="xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      ) : null}
    </div>
  );
}
