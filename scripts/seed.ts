/**
 * Development seed.
 *
 * Creates an admin, a spread of monitors covering every kind, and 30 days of
 * synthetic check history with plausible outages — enough to make the charts,
 * grades, rollups, and status pages meaningful without waiting a month for real
 * data. Contributors need this to work on the UI at all.
 *
 *   pnpm seed
 *
 * Refuses to run against a database that already has users, so it cannot clobber a
 * real instance.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/index.ts";
import {
  channels,
  checks,
  incidentEvents,
  incidents,
  monitorChannels,
  monitors,
  statusPageItems,
  statusPages,
  users,
} from "../src/lib/db/schema.ts";
import { hashPassword } from "../src/lib/auth/password.ts";
import { newHeartbeatToken } from "../src/lib/ids.ts";
import { rollupMonitorFully } from "../src/lib/scheduler/rollup.ts";

const SEED_EMAIL = "dev@watchman.local";
const SEED_PASSWORD = "watchman-dev-password";

const DAY = 86_400_000;

/** Deterministic PRNG so successive seeds produce comparable-looking data. */
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry(20260729);

interface Plan {
  name: string;
  description?: string;
  kind: "http" | "tcp" | "ping" | "ssl" | "heartbeat";
  target: string;
  intervalSec: number;
  baseLatency: number;
  jitter: number;
  degradedMs?: number;
  /** Probability any given check fails, before scripted outages. */
  failureRate: number;
  /** Scripted outages as [daysAgo, durationMinutes]. */
  outages?: [number, number][];
  sloTargetPct?: number;
  expectedStatus?: string;
  keyword?: string;
}

const PLANS: Plan[] = [
  {
    name: "Marketing site",
    description: "Public landing page behind the CDN.",
    kind: "http",
    target: "https://example.com",
    intervalSec: 60,
    baseLatency: 78,
    jitter: 30,
    failureRate: 0,
    sloTargetPct: 99.9,
  },
  {
    name: "API — production",
    description: "Core REST API health endpoint.",
    kind: "http",
    target: "https://api.example.com/health",
    intervalSec: 60,
    baseLatency: 145,
    jitter: 70,
    degradedMs: 400,
    failureRate: 0.001,
    outages: [
      [3, 14],
      [11, 6],
    ],
    sloTargetPct: 99.95,
    keyword: "ok",
  },
  {
    name: "Checkout service",
    description: "Payment flow — the one that costs money when it breaks.",
    kind: "http",
    target: "https://checkout.example.com/healthz",
    intervalSec: 30,
    baseLatency: 260,
    jitter: 190,
    degradedMs: 500,
    failureRate: 0.004,
    outages: [
      [1, 22],
      [6, 3],
      [6, 4],
      [6, 5],
      [17, 41],
    ],
    sloTargetPct: 99.9,
  },
  {
    name: "Postgres primary",
    kind: "tcp",
    target: "db.internal:5432",
    intervalSec: 60,
    baseLatency: 4,
    jitter: 3,
    failureRate: 0.0004,
    outages: [[8, 9]],
  },
  {
    name: "Redis cache",
    kind: "tcp",
    target: "cache.internal:6379",
    intervalSec: 60,
    baseLatency: 2,
    jitter: 2,
    failureRate: 0,
  },
  {
    name: "Edge gateway",
    kind: "ping",
    target: "1.1.1.1",
    intervalSec: 120,
    baseLatency: 16,
    jitter: 12,
    failureRate: 0.002,
  },
  {
    name: "TLS — example.com",
    description: "Certificate expiry watch.",
    kind: "ssl",
    target: "example.com",
    intervalSec: 21_600,
    baseLatency: 95,
    jitter: 40,
    failureRate: 0,
  },
  {
    name: "Nightly backup",
    description: "Dead man's switch for the 03:00 pg_dump.",
    kind: "heartbeat",
    target: "",
    intervalSec: 86_400,
    baseLatency: 0,
    jitter: 0,
    failureRate: 0,
    outages: [[13, 1440]],
  },
  {
    name: "Queue worker",
    description: "Pings every 5 minutes while draining jobs.",
    kind: "heartbeat",
    target: "",
    intervalSec: 300,
    baseLatency: 0,
    jitter: 0,
    failureRate: 0.002,
  },
];

function inOutage(plan: Plan, at: number, now: number): boolean {
  for (const [daysAgo, minutes] of plan.outages ?? []) {
    const start = now - daysAgo * DAY;
    if (at >= start && at < start + minutes * 60_000) return true;
  }
  return false;
}

async function main() {
  const existing = db.select({ n: sql<number>`count(*)` }).from(users).get();
  if ((existing?.n ?? 0) > 0) {
    console.error(
      "[seed] refusing to run — this database already has users. Delete ./data/watchman.db first if this is a dev instance.",
    );
    process.exit(1);
  }

  console.log("[seed] creating admin…");
  const admin = db
    .insert(users)
    .values({
      name: "Dev Admin",
      email: SEED_EMAIL,
      passwordHash: await hashPassword(SEED_PASSWORD),
      role: "admin",
    })
    .returning({ id: users.id })
    .get();

  console.log("[seed] creating alert channels…");
  const webhook = db
    .insert(channels)
    .values({
      name: "Local webhook sink",
      kind: "webhook",
      config: JSON.stringify({
        url: "http://localhost:9999/hook",
        secret: "seed-webhook-secret-value-1234",
      }),
      notifyOnRecovery: true,
    })
    .returning({ id: channels.id })
    .get();

  const now = Date.now();
  const HISTORY_DAYS = 30;

  for (const plan of PLANS) {
    console.log(`[seed] ${plan.name} — generating ${HISTORY_DAYS}d of history…`);

    const monitor = db
      .insert(monitors)
      .values({
        name: plan.name,
        description: plan.description ?? null,
        kind: plan.kind,
        target: plan.target,
        intervalSec: plan.intervalSec,
        degradedMs: plan.degradedMs ?? null,
        expectedStatus: plan.expectedStatus ?? "2xx",
        keyword: plan.keyword ?? null,
        sloTargetPct: plan.sloTargetPct ?? 99.9,
        heartbeatToken: plan.kind === "heartbeat" ? newHeartbeatToken() : null,
        createdAt: new Date(now - HISTORY_DAYS * DAY),
        createdBy: admin.id,
      })
      .returning()
      .get();

    db.insert(monitorChannels)
      .values({ monitorId: monitor.id, channelId: webhook.id })
      .run();

    /*
     * Real intervals would mean 86k rows for the 30s monitor, which makes seeding
     * slow and the dev database large for no benefit. Sample at a floor of 10
     * minutes and keep the *shape* — outages, latency drift, degradation — which is
     * what the UI is being developed against.
     */
    const stepMs = Math.max(plan.intervalSec * 1000, 600_000);
    const rows: (typeof checks.$inferInsert)[] = [];

    // A slow upward latency drift over the month, so charts have a trend to show.
    let drift = 0;
    let openedAt: number | null = null;
    const outageSpans: [number, number][] = [];

    for (let at = now - HISTORY_DAYS * DAY; at <= now; at += stepMs) {
      drift += (rand() - 0.48) * 0.4;
      const down = inOutage(plan, at, now) || rand() < plan.failureRate;

      if (down && openedAt === null) openedAt = at;
      if (!down && openedAt !== null) {
        outageSpans.push([openedAt, at]);
        openedAt = null;
      }

      if (down) {
        rows.push({
          monitorId: monitor.id,
          at: new Date(at),
          ok: false,
          status: "down",
          latencyMs: null,
          httpStatus: plan.kind === "http" ? 503 : null,
          error:
            plan.kind === "heartbeat"
              ? "No ping received within the grace period"
              : plan.kind === "tcp"
                ? "Connection refused"
                : "Expected 2xx, got 503",
        });
        continue;
      }

      const latency =
        plan.kind === "heartbeat"
          ? null
          : Math.max(
              1,
              Math.round(
                plan.baseLatency +
                  drift * 8 +
                  (rand() - 0.5) * plan.jitter * 2 +
                  // Occasional latency spike, so p95 is meaningfully above p50.
                  (rand() < 0.02 ? plan.baseLatency * 2.5 : 0),
              ),
            );

      const degraded =
        plan.degradedMs != null && latency != null && latency > plan.degradedMs;

      rows.push({
        monitorId: monitor.id,
        at: new Date(at),
        ok: true,
        status: degraded ? "degraded" : "up",
        latencyMs: latency,
        httpStatus: plan.kind === "http" ? 200 : null,
        error: degraded ? `Slow response (${latency}ms)` : null,
      });
    }

    // Insert in chunks — SQLite caps a statement at 999 bound parameters.
    const CHUNK = 400;
    db.transaction((tx) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        tx.insert(checks).values(rows.slice(i, i + CHUNK)).run();
      }
    });

    // Matching incident records, so the timeline and grade agree with the history.
    for (const [start, end] of outageSpans) {
      const created = db
        .insert(incidents)
        .values({
          monitorId: monitor.id,
          status: "resolved",
          severity: "down",
          startedAt: new Date(start),
          resolvedAt: new Date(end),
          cause:
            plan.kind === "heartbeat"
              ? "No ping received within the grace period"
              : "Expected 2xx, got 503",
          failedChecks: Math.max(1, Math.round((end - start) / stepMs)),
        })
        .returning({ id: incidents.id })
        .get();

      db.insert(incidentEvents)
        .values([
          {
            incidentId: created.id,
            at: new Date(start),
            kind: "opened",
            message: "2 consecutive failed checks",
          },
          {
            incidentId: created.id,
            at: new Date(end),
            kind: "resolved",
            message: `Recovered after ${Math.round((end - start) / 1000)}s`,
          },
        ])
        .run();
    }

    const last = rows[rows.length - 1];
    if (last) {
      db.update(monitors)
        .set({
          lastStatus: last.status,
          lastCheckedAt: last.at as Date,
          lastLatencyMs: last.latencyMs ?? null,
          lastError: last.error ?? null,
          lastStatusChangedAt: last.at as Date,
        })
        .where(sql`${monitors.id} = ${monitor.id}`)
        .run();
    }

    rollupMonitorFully(monitor.id);
    console.log(`[seed]   ${rows.length} checks, ${outageSpans.length} incidents`);
  }

  console.log("[seed] creating a public status page…");
  const page = db
    .insert(statusPages)
    .values({
      slug: "status",
      title: "Example Inc. Status",
      description: "Live availability for our public services.",
      published: true,
    })
    .returning({ id: statusPages.id })
    .get();

  const publicMonitors = db.select().from(monitors).all();
  db.insert(statusPageItems)
    .values(
      publicMonitors
        .filter((m) => ["Marketing site", "API — production", "Checkout service"].includes(m.name))
        .map((m, i) => ({
          pageId: page.id,
          monitorId: m.id,
          groupName: "Public services",
          sortOrder: i,
        })),
    )
    .run();

  console.log("");
  console.log("[seed] done.");
  console.log(`[seed]   sign in with  ${SEED_EMAIL}  /  ${SEED_PASSWORD}`);
  console.log("[seed]   status page   /status/status");
}

main().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
