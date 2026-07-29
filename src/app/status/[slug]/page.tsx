import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { checks, incidents } from "@/lib/db/schema";
import { CropFrame, Panel, Rule } from "@/components/ui/frame";
import { GradeBadge } from "@/components/ui/grade-badge";
import { Mark } from "@/components/ui/logo";
import { MonoLabel, Readout } from "@/components/ui/mono";
import { StatusPill, UptimeTape } from "@/components/ui/status";
import { computeGrade } from "@/lib/metrics/grade";
import {
  WINDOWS,
  formatDuration,
  formatMs,
  formatUptime,
  summarize,
  type MonitorStatus,
} from "@/lib/metrics/uptime";
import { getCurrentUser } from "@/lib/auth/session";
import { dailyTape, getStatusPageBySlug } from "@/lib/queries";

/**
 * The public status page.
 *
 * Deliberately outside the (app) group: no session, no nav, no live tape, and its
 * own root layout concerns. It has to render for someone who has never heard of
 * Watchman and is only asking one question, so the answer is the largest thing on
 * the page.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const found = getStatusPageBySlug((await params).slug);
  if (!found) return { title: "Status" };
  return {
    title: found.page.title,
    description: found.page.description ?? undefined,
    // Unlike the rest of the app, a published status page *should* be indexable.
    robots: found.page.published ? { index: true, follow: true } : { index: false },
  };
}

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const found = getStatusPageBySlug(slug);
  if (!found) notFound();

  const { page, items } = found;

  // Drafts stay previewable for signed-in users so a page can be checked before
  // its link is announced.
  if (!page.published && !(await getCurrentUser())) notFound();

  const since = new Date(Date.now() - WINDOWS["24h"]);
  const since30d = new Date(Date.now() - WINDOWS["30d"]);

  const services = items.map(({ item, monitor }) => {
    const rows = db
      .select({ ok: checks.ok, latencyMs: checks.latencyMs })
      .from(checks)
      .where(and(eq(checks.monitorId, monitor.id), gte(checks.at, since)))
      .all();

    const summary = summarize(rows, monitor.degradedMs);
    const incidentCount =
      db
        .select({ n: sql<number>`count(*)` })
        .from(incidents)
        .where(
          and(eq(incidents.monitorId, monitor.id), gte(incidents.startedAt, since30d)),
        )
        .get()?.n ?? 0;

    const graded = computeGrade({
      uptimePct: summary.uptimePct,
      p95Ms: summary.p95Ms,
      incidentsPer30d: incidentCount,
    });

    const status: MonitorStatus = monitor.paused
      ? "paused"
      : !monitor.lastCheckedAt
        ? "pending"
        : monitor.lastStatus;

    return {
      id: monitor.id,
      // Public name overrides the internal one, so internal names can stay blunt.
      name: item.displayName ?? monitor.name,
      group: item.groupName,
      status,
      summary,
      grade: graded.grade,
      tape: dailyTape(monitor.id, page.historyDays),
    };
  });

  const openIncidents = db
    .select({ incident: incidents })
    .from(incidents)
    .where(ne(incidents.status, "resolved"))
    .orderBy(desc(incidents.startedAt))
    .all()
    .filter((r) => services.some((s) => s.id === r.incident.monitorId));

  const anyDown = services.some((s) => s.status === "down");
  const anyDegraded = services.some((s) => s.status === "degraded");

  const headline = anyDown
    ? "Some systems are down"
    : anyDegraded
      ? "Some systems are degraded"
      : "All systems operational";

  const overallUptime =
    services.filter((s) => s.summary.total > 0).length === 0
      ? 100
      : services
          .filter((s) => s.summary.total > 0)
          .reduce((a, s) => a + s.summary.uptimePct, 0) /
        services.filter((s) => s.summary.total > 0).length;

  // Group headings only make sense once more than one group exists.
  const groups = new Map<string, typeof services>();
  for (const s of services) {
    const key = s.group ?? "";
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-10 px-5 py-12 sm:py-16">
      {!page.published ? (
        <div className="border border-warn/40 bg-warn/10 px-4 py-2.5">
          <MonoLabel tone="amp">
            draft — visible to you because you are signed in
          </MonoLabel>
        </div>
      ) : null}

      {/* ---- hero -------------------------------------------------------- */}
      <header className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold tracking-tight text-bone">
          {page.title}
        </h1>

        <CropFrame
          hatch
          tone={anyDown ? "alarm" : anyDegraded ? "amp" : "live"}
          className="p-6 sm:p-8"
        >
          <MonoLabel tone={anyDown ? "alarm" : anyDegraded ? "amp" : "live"}>
            current status
          </MonoLabel>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
            <h2
              className={
                anyDown
                  ? "text-3xl font-semibold tracking-tight text-alarm sm:text-4xl"
                  : anyDegraded
                    ? "text-3xl font-semibold tracking-tight text-warn sm:text-4xl"
                    : "text-3xl font-semibold tracking-tight text-live sm:text-4xl"
              }
            >
              {headline}
            </h2>
            <Readout
              label="uptime · 24h"
              value={formatUptime(overallUptime)}
              size="sm"
            />
          </div>

          {page.description ? (
            <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-ash">
              {page.description}
            </p>
          ) : null}
        </CropFrame>
      </header>

      {/* ---- active incidents -------------------------------------------- */}
      {openIncidents.length > 0 ? (
        <section className="flex flex-col gap-3">
          <MonoLabel tone="alarm">active incidents</MonoLabel>
          <Panel className="divide-y divide-hairline-soft">
            {openIncidents.map(({ incident }) => {
              const service = services.find((s) => s.id === incident.monitorId);
              return (
                <div key={incident.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="text-[14px] font-medium text-bone">
                      {service?.name ?? "Service"}
                    </span>
                    <span className="tnum font-mono text-[11px] text-alarm">
                      ongoing {formatDuration(Date.now() - incident.startedAt.getTime())}
                    </span>
                  </div>
                  {/* Internal error text is deliberately not published — a raw
                      ECONNREFUSED tells a customer nothing and leaks topology. */}
                  <p className="text-[12px] text-ash">
                    {incident.status === "acknowledged"
                      ? "We are aware of this and investigating."
                      : "We are investigating."}
                  </p>
                  <span className="tnum font-mono text-[10px] text-slate">
                    since{" "}
                    {incident.startedAt.toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              );
            })}
          </Panel>
        </section>
      ) : null}

      {/* ---- services ---------------------------------------------------- */}
      {services.length === 0 ? (
        <Panel inset>
          <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-slate">
            no services published yet
          </p>
        </Panel>
      ) : (
        [...groups.entries()].map(([group, list]) => (
          <section key={group} className="flex flex-col gap-3">
            {group && groups.size > 1 ? <MonoLabel>{group}</MonoLabel> : null}

            <Panel className="divide-y divide-hairline-soft">
              {list.map((s) => (
                <div key={s.id} className="flex flex-col gap-3 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {page.showGrades ? (
                        <GradeBadge grade={s.grade} size="xs" />
                      ) : null}
                      <span className="truncate text-[14px] text-bone">{s.name}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-5">
                      {page.showLatency && s.summary.p95Ms !== null ? (
                        <span className="tnum font-mono text-[11px] text-slate">
                          {formatMs(s.summary.p95Ms)}
                        </span>
                      ) : null}
                      <span className="tnum font-mono text-[11px] text-ash">
                        {s.summary.total === 0
                          ? "—"
                          : formatUptime(s.summary.uptimePct)}
                      </span>
                      <StatusPill status={s.status} />
                    </div>
                  </div>

                  <UptimeTape
                    height={28}
                    buckets={s.tape.map((d) => ({
                      status: d.status,
                      label: new Date(d.day).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      }),
                      detail:
                        d.uptimePct === null
                          ? "no data"
                          : `${formatUptime(d.uptimePct)} uptime`,
                    }))}
                  />
                </div>
              ))}
            </Panel>
          </section>
        ))
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonoLabel tone="slate">
          {page.historyDays} days of history · updated{" "}
          {new Date().toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </MonoLabel>
        {page.contactUrl ? (
          <a
            href={page.contactUrl}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-amp hover:underline"
          >
            report a problem →
          </a>
        ) : null}
      </div>

      <Rule />

      <footer className="flex items-center justify-center gap-2 pb-4">
        <Mark size={13} className="text-slate" live={false} />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate">
          monitored with Watchman
        </span>
      </footer>
    </main>
  );
}
