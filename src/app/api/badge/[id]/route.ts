import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { checks, incidents, monitors } from "@/lib/db/schema";
import { BADGE_HEX, GRADE_HEX, computeGrade } from "@/lib/metrics/grade";
import { WINDOWS, formatUptime, summarize } from "@/lib/metrics/uptime";

/**
 * Embeddable SVG badge.
 *
 *   ![uptime](https://watch.example.com/api/badge/MONITOR_ID)
 *
 * Public by design — a badge is meant for a README, and a badge that needs a
 * session cookie is useless. It exposes only what a status page would: a grade or an
 * uptime percentage. No target, no error text, no monitor name unless asked for.
 *
 * Rendered by hand rather than proxied through shields.io, so the badge inherits
 * Watchman's own square, hairline look instead of a rounded pill, and so a private
 * instance never has to phone out to a third party to draw it.
 */
export const dynamic = "force-dynamic";

type Style = "grade" | "uptime";

/** Approximate advance width per character for Geist Mono at 11px, in px. */
const CHAR_W = 6.6;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badge({
  label,
  value,
  valueColor,
  labelColor = BADGE_HEX.label,
}: {
  label: string;
  value: string;
  valueColor: string;
  labelColor?: string;
}): string {
  const PAD = 8;
  const H = 20;
  const labelW = Math.ceil(label.length * CHAR_W + PAD * 2);
  const valueW = Math.ceil(value.length * CHAR_W + PAD * 2);
  const W = labelW + valueW;

  // Fonts are named rather than embedded — a data-URI webfont would multiply the
  // badge's size for a face most READMEs render in the platform mono anyway.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <title>${escapeXml(label)}: ${escapeXml(value)}</title>
  <g shape-rendering="crispEdges">
    <rect width="${labelW}" height="${H}" fill="${labelColor}"/>
    <rect x="${labelW}" width="${valueW}" height="${H}" fill="${valueColor}"/>
  </g>
  <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="11" letter-spacing="0.6">
    <text x="${labelW / 2}" y="14" text-anchor="middle" fill="${BADGE_HEX.labelText}">${escapeXml(label)}</text>
    <text x="${labelW + valueW / 2}" y="14" text-anchor="middle" fill="${BADGE_HEX.valueText}" font-weight="600">${escapeXml(value)}</text>
  </g>
</svg>`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const style: Style = url.searchParams.get("style") === "uptime" ? "uptime" : "grade";
  const customLabel = url.searchParams.get("label")?.slice(0, 32);

  const respond = (svg: string, cacheSec: number) =>
    new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        // Short cache: a badge showing yesterday's uptime is worse than no badge.
        // `stale-while-revalidate` keeps GitHub's proxy from ever blocking on us.
        "cache-control": `public, max-age=${cacheSec}, stale-while-revalidate=600`,
      },
    });

  const monitor = db
    .select({
      id: monitors.id,
      name: monitors.name,
      paused: monitors.paused,
      degradedMs: monitors.degradedMs,
    })
    .from(monitors)
    .where(eq(monitors.id, id))
    .get();

  if (!monitor) {
    // 200 with an "unknown" badge, not 404: GitHub's camo proxy renders a broken
    // image for a 404, which looks like the project is broken rather than the id.
    return respond(
      badge({ label: customLabel ?? "uptime", value: "unknown", valueColor: BADGE_HEX.inactive }),
      60,
    );
  }

  const since = new Date(Date.now() - WINDOWS["24h"]);
  const rows = db
    .select({ ok: checks.ok, latencyMs: checks.latencyMs })
    .from(checks)
    .where(and(eq(checks.monitorId, id), gte(checks.at, since)))
    .all();

  if (monitor.paused) {
    return respond(
      badge({ label: customLabel ?? "uptime", value: "paused", valueColor: BADGE_HEX.inactive }),
      300,
    );
  }

  if (rows.length === 0) {
    return respond(
      badge({ label: customLabel ?? "uptime", value: "no data", valueColor: BADGE_HEX.inactive }),
      60,
    );
  }

  const summary = summarize(rows, monitor.degradedMs);
  const incidentCount =
    db
      .select({ n: sql<number>`count(*)` })
      .from(incidents)
      .where(
        and(
          eq(incidents.monitorId, id),
          gte(incidents.startedAt, new Date(Date.now() - WINDOWS["30d"])),
        ),
      )
      .get()?.n ?? 0;

  const graded = computeGrade({
    uptimePct: summary.uptimePct,
    p95Ms: summary.p95Ms,
    incidentsPer30d: incidentCount,
  });

  if (style === "uptime") {
    return respond(
      badge({
        label: customLabel ?? "uptime",
        value: formatUptime(summary.uptimePct),
        valueColor:
          summary.uptimePct >= 99.9
            ? GRADE_HEX.A
            : summary.uptimePct >= 99
              ? GRADE_HEX.C
              : GRADE_HEX.F,
      }),
      300,
    );
  }

  return respond(
    badge({
      label: customLabel ?? "watchman",
      value: `${graded.grade} · ${formatUptime(summary.uptimePct)}`,
      valueColor: GRADE_HEX[graded.grade],
    }),
    300,
  );
}
