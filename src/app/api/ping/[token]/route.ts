import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitors } from "@/lib/db/schema";
import { publish } from "@/lib/events/bus";
import { recordCheck } from "@/lib/incidents/engine";
import { rateLimit } from "@/lib/rate-limit";
import type { ProbeResult } from "@/lib/probe/types";

/**
 * Heartbeat ingest — the URL a cron job, worker, or backup script calls when it
 * finishes.
 *
 *   0 3 * * *  /opt/backup.sh && curl -fsS -m 10 $WATCHMAN/api/ping/TOKEN
 *
 * Deliberately forgiving about method and shape, because the callers are one-line
 * additions to shell scripts written by people who should not have to read docs:
 *
 *   GET  or POST                     both work
 *   ?status=fail                     the job ran and failed
 *   ?ms=1234                         how long the job took
 *   ?msg=...  or a request body      failure detail, shown on the timeline
 *
 * The token is a bearer capability, stored in plaintext because it has to be
 * displayed for pasting into a crontab. Holding one lets you mark a job alive or
 * failed and nothing else — it grants no read access and no configuration change.
 */

export const dynamic = "force-dynamic";

async function handlePing(
  request: Request,
  token: string,
): Promise<NextResponse> {
  // Generous, but enough to stop a misconfigured loop from filling the database.
  const limited = rateLimit(`ping:${token}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many pings" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSec) } },
    );
  }

  const monitor = db
    .select()
    .from(monitors)
    .where(eq(monitors.heartbeatToken, token))
    .get();

  // Say "unknown token" rather than confirming the monitor exists but is the
  // wrong kind — a 404 leaks less and is equally actionable.
  if (!monitor || monitor.kind !== "heartbeat") {
    return NextResponse.json(
      { ok: false, error: "Unknown heartbeat token" },
      { status: 404 },
    );
  }

  if (monitor.paused) {
    return NextResponse.json({ ok: true, status: "paused", recorded: false });
  }

  const url = new URL(request.url);
  const failed =
    url.searchParams.get("status") === "fail" ||
    url.searchParams.get("status") === "down";

  const rawMs = Number(url.searchParams.get("ms"));
  const durationMs = Number.isFinite(rawMs) && rawMs >= 0 ? Math.round(rawMs) : null;

  let detail = url.searchParams.get("msg")?.slice(0, 500) ?? null;
  if (!detail && request.method === "POST") {
    try {
      const body = await request.text();
      if (body) detail = body.slice(0, 500).replace(/\s+/g, " ").trim();
    } catch {
      /* unreadable body is not worth failing the ping over */
    }
  }

  const result: ProbeResult = failed
    ? {
        ok: false,
        status: "down",
        latencyMs: durationMs,
        error: detail
          ? `Job reported failure: ${detail}`
          : "Job reported failure",
        meta: { source: "heartbeat", reportedFailure: true, durationMs },
      }
    : {
        ok: true,
        status: "up",
        latencyMs: durationMs,
        error: null,
        meta: { source: "heartbeat", durationMs, detail },
      };

  await recordCheck(monitor, result);

  publish({
    type: "heartbeat_ping",
    at: Date.now(),
    monitorId: monitor.id,
    monitorName: monitor.name,
  });

  return NextResponse.json({
    ok: true,
    monitor: monitor.name,
    status: result.status,
    // Tells the job when Watchman will start worrying, which is useful in logs.
    nextExpectedBySec: monitor.intervalSec + monitor.graceSec,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return handlePing(request, (await params).token);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return handlePing(request, (await params).token);
}

/** Some monitoring wrappers probe with HEAD before committing to a call. */
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const res = await handlePing(request, (await params).token);
  return new NextResponse(null, { status: res.status });
}
