<div align="center">

# Watchman

**Self-hosted end-to-end monitoring.** Synthetic checks, dead man's switch heartbeats,
incident timelines, and public status pages — in one container, with no external services.

```
docker run -d -p 3000:3000 -v watchman:/data \
  -e WATCHMAN_SECRET=$(openssl rand -hex 32) \
  ghcr.io/phugadev/watchman:latest
```

</div>

---

## What it does

Watchman watches things and tells you when they break. Five kinds of check:

| Kind | What it proves | Good for |
| --- | --- | --- |
| **HTTP** | Status code, response body, and latency are all what you expect | APIs, web apps, health endpoints |
| **TCP** | Something is listening and accepting connections | Postgres, Redis, SMTP, game servers |
| **Ping** | The host is reachable at all | Routers, VMs, bare metal |
| **TLS** | The certificate is valid and not about to expire | Every domain you own |
| **Heartbeat** | A job that should have run, ran | Cron, backups, queue workers, ETL |

That last one is the inverse of the others, and the reason a lot of people end up
needing something like this. Active probing cannot see a backup script that stopped
firing — there is no endpoint to poll, and silence produces no errors. So the job calls
Watchman instead, and Watchman alerts when the call stops coming.

## Why you might want it

- **One container, one file.** SQLite, an in-process scheduler, no Redis, no Postgres,
  no worker sidecar. `docker run` and you are monitoring.
- **Alerts you will not learn to ignore.** Confirmation delays before opening an
  incident, flap dampening for unstable endpoints, maintenance windows, and per-channel
  opt-outs for recoveries and slowdowns.
- **A grade, not just a percentage.** 99.5% and 99.9% look identical and differ by two
  hours a month. Every monitor is scored S–F over uptime, p95 latency, and how *often*
  it breaks — then handed to you as an embeddable badge.
- **Error budgets, not trivia.** "6 minutes of downtime left this month" is a decision.
  "99.87%" is homework.
- **Real request timing.** Every HTTP check records DNS, TCP, TLS, and TTFB separately,
  because "your DNS is slow" and "your app is slow" are the same number on a
  single-value chart.
- **Status pages people can read.** Pick which monitors are public, publish 90 days of
  history, and internal error text never leaks.

## Quickstart

### Docker

```bash
# A signing secret is mandatory — it signs session cookies and webhook payloads.
export WATCHMAN_SECRET=$(openssl rand -hex 32)

docker run -d --name watchman \
  -p 3000:3000 \
  -v watchman-data:/data \
  -e WATCHMAN_SECRET \
  -e WATCHMAN_URL=https://watch.example.com \
  ghcr.io/phugadev/watchman:latest
```

Open `http://localhost:3000`. The first visit creates the admin account; after that
`/setup` closes permanently.

### Docker Compose

```bash
cp .env.example .env      # then set WATCHMAN_SECRET
docker compose up -d
```

This builds from source by default, so it works straight from a clone with no registry
involved. To run a published image instead, uncomment the `image:` line in
`docker-compose.yml` and drop `build: .`.

### From source

```bash
pnpm install
pnpm seed                 # optional: 30 days of demo data across all five kinds
pnpm dev
```

`pnpm seed` prints the credentials it creates. It refuses to run against a database
that already has users.

## Configuration

Everything is environment-driven, so a deployment is fully described by its compose
file rather than by settings someone clicked into a database.

| Variable | Default | What it does |
| --- | --- | --- |
| `WATCHMAN_SECRET` | — | **Required in production.** Signs session cookies, webhook HMACs, and token hashes. `openssl rand -hex 32`. Changing it invalidates every session and invite. |
| `WATCHMAN_URL` | `http://localhost:3000` | Public origin. Used to build heartbeat URLs and status-page links — set this, or your cron snippets will point at localhost. |
| `WATCHMAN_DB_PATH` | `/data/watchman.db` | SQLite file. Must be on a mounted volume. |
| `WATCHMAN_SCHEDULER` | `true` | Set `false` to run a web-only process with no probing. |
| `WATCHMAN_TICK_MS` | `5000` | How often the scheduler looks for due monitors. |
| `WATCHMAN_MAX_CONCURRENCY` | `12` | Maximum simultaneous probes. |
| `WATCHMAN_RAW_RETENTION_DAYS` | `14` | How long individual check rows are kept. |
| `WATCHMAN_HOURLY_RETENTION_DAYS` | `90` | Hourly rollups. |
| `WATCHMAN_DAILY_RETENTION_DAYS` | `730` | Daily rollups. |
| `WATCHMAN_SESSION_TTL_DAYS` | `30` | Session lifetime. |
| `WATCHMAN_INVITE_TTL_HOURS` | `72` | Invite link lifetime. |
| `WATCHMAN_USER_AGENT` | `Watchman/0.1 …` | Identifies probes in your targets' access logs. |

Incidents and their timelines are never pruned. They are the audit trail, they are
small, and losing them quietly would be worse than the disk they cost.

## Heartbeats

Create a heartbeat monitor and Watchman gives you a URL. Call it when your job
finishes:

```bash
# Pings only on success, so a failed backup still alerts.
0 3 * * *  /opt/backup.sh && curl -fsS -m 10 https://watch.example.com/api/ping/TOKEN
```

`-fsS -m 10` matters: fail quietly on HTTP errors but still report them, and never let
a hung Watchman hold your cron job open.

To report failures explicitly:

```bash
/opt/backup.sh \
  && curl -fsS -m 10 "$PING" \
  || curl -fsS -m 10 "$PING?status=fail&msg=exit_$?"
```

| Parameter | Effect |
| --- | --- |
| `?status=fail` | The job ran and failed. Opens an incident. |
| `?ms=1234` | How long the job took, recorded as latency. |
| `?msg=…` | Failure detail, shown on the incident timeline. A `POST` body works too. |

`GET`, `POST`, and `HEAD` all work. The token is a bearer capability: holding it lets
you mark that job alive or failed and nothing else. Rotate it from the monitor page if
it leaks.

## Maintenance windows

Schedule one before a deploy and Watchman stays quiet for the duration instead of
paging whoever is on call. Two modes:

| Mode | Behaviour |
| --- | --- |
| **Suppress alerts** (default) | Keeps probing and recording, sends nothing. The incident still opens, is marked suppressed, and its timeline notes which window silenced it — so the post-mortem is intact. |
| **Pause checks** | Stops probing entirely. For maintenance where the service is deliberately offline and the failure data would be noise. |

Suppress is almost always the right choice: you want the data, you just don't want the
page. An active window is called out on the dashboard, because an operator looking at a
quiet dashboard needs to know whether it is quiet or muted.

Windows can be ended early, which sets the end to now rather than deleting the record —
the reason alerts were withheld for that period stays readable afterwards.

## Alerting

### Webhooks

Watchman `POST`s JSON, signed with HMAC-SHA256 over `` `${timestamp}.${body}` ``. The
timestamp is inside the signed string so a captured request cannot be replayed — reject
anything older than five minutes.

```js
import crypto from "node:crypto";

const ts = req.headers["x-watchman-timestamp"];
const expected = crypto
  .createHmac("sha256", SECRET)
  .update(`${ts}.${rawBody}`)
  .digest("hex");

const given = req.headers["x-watchman-signature"].replace("sha256=", "");
const valid =
  given.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));

if (!valid || Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
  return res.status(401).end();
}
```

| Header | Value |
| --- | --- |
| `x-watchman-event` | `monitor.down` · `monitor.up` · `monitor.degraded` · `test` |
| `x-watchman-timestamp` | Unix seconds |
| `x-watchman-signature` | `sha256=<hex>` |
| `x-watchman-delivery` | Idempotency key, for discarding retries you already handled |

The payload carries the monitor, the incident, the failing check, and rolling 24h
health — so an alert is actionable without a round trip back to the dashboard.

### Telegram

Talk to [@BotFather](https://t.me/botfather), run `/newbot`, and paste the token and
your chat id. Add the bot to the chat first or it cannot post.

Only 5xx, 429, and network errors are retried; a 400 means the payload or URL is wrong,
and retrying it just triples the log. Every attempt is recorded, so "was anyone actually
paged?" is answerable after the fact.

## Badges

Every monitor exposes an SVG badge for your README:

```md
![status](https://watch.example.com/api/badge/MONITOR_ID)
![uptime](https://watch.example.com/api/badge/MONITOR_ID?style=uptime)
![api](https://watch.example.com/api/badge/MONITOR_ID?style=uptime&label=api)
```

Badges are public — one that needs a session cookie is useless — and expose only what a
status page would: a grade or an uptime percentage.

## How grading works

A composite score over three components, then bucketed into a letter:

| Component | Weight | Why |
| --- | --- | --- |
| Uptime | 65% | Anchored so each additional "nine" is worth more than the last, matching how operators actually feel it |
| p95 latency | 20% | Sub-200ms is free; 3s is close to failure |
| Incident frequency | 15% | Ten one-minute outages hurt more than one ten-minute outage at identical uptime |

| Grade | Score | |
| --- | --- | --- |
| **S** | ≥ 95 | Flawless |
| **A** | ≥ 87 | Healthy |
| **B** | ≥ 76 | Acceptable |
| **C** | ≥ 62 | Degraded |
| **D** | ≥ 45 | Unreliable |
| **F** | < 45 | Failing |

Monitors with no meaningful latency (heartbeats) redistribute that weight rather than
scoring zero, so a perfectly reliable cron job can still earn an S. Every threshold is
an explicit interpolation anchor in [`grade.ts`](src/lib/metrics/grade.ts) — tune them
if you disagree.

## Architecture

```
instrumentation.ts          boots the scheduler once per server process
  └─ lib/scheduler          tick loop over a next_run_at column
       ├─ lib/probe         http · tcp · ping · ssl · heartbeat  (pure, testable)
       ├─ lib/incidents     state machine → transaction → notify
       │    └─ lib/notify   webhook · telegram, with retries and a delivery log
       ├─ rollup.ts         hourly + daily aggregates
       └─ retention.ts      prunes raw checks, keeps the rollups
lib/events/bus.ts           in-process pub/sub → SSE → the live tape
lib/maintenance             window scheduling; phase derived from the clock, never stored
lib/db                      Drizzle schema, WAL SQLite, migrations on boot
```

Some decisions and their reasons:

- **A tick loop, not a queue.** BullMQ would mean Redis; cron cannot express sub-minute
  intervals. A `next_run_at` column gives per-monitor cadence, survives restarts, and
  needs nothing that is not already there.
- **The next slot is reserved before probing**, so a crash mid-check resumes on the
  normal cadence instead of retrying on every restart.
- **`node:http`, not `fetch`.** fetch cannot expose DNS/TCP/TLS boundaries, disable
  certificate verification per request, or surface the peer certificate. Watchman needs
  all three. Sockets are never pooled, since a reused connection skips the handshake and
  reports a latency no real user experiences.
- **Notifications dispatch after the transaction commits.** Holding a SQLite write lock
  open across a network call to Telegram would stall every other probe.
- **The stored status mirrors the probe verbatim.** Confirmation gates alerts, not the
  display — otherwise the uptime tape would disagree with the check history for the same
  minute.
- **Rollups make long windows cheap.** A 90-day status page over 60-second checks would
  otherwise touch ~130k rows per monitor; pre-aggregation makes it 90.
- **`/api/health` returns 503 when the probe loop stalls**, not only when the web server
  dies. A monitoring tool serving green pages with a dead scheduler is worse than one
  that is plainly down.

## Security notes

- Session and invite tokens are stored as keyed SHA-256 hashes. A leaked database yields
  no usable credentials.
- Passwords use scrypt at N=32768 (~100ms per verification). Parameters live in the hash
  record, so the cost can be raised later without locking anyone out.
- Login reports one message for unknown-email and wrong-password, and spends the hashing
  time either way, so it is neither an enumeration nor a timing oracle.
- Watchman makes outbound requests to URLs you configure. That is the product. If you
  expose it to people you do not fully trust, put it behind a network policy — a monitor
  can by design reach whatever the container can reach.
- Heartbeat tokens are stored in plaintext because they must be displayed for pasting
  into a crontab. They grant only the ability to mark one job alive or failed.

## Development

```bash
pnpm dev            # dev server
pnpm test           # unit tests
pnpm typecheck      # tsc --noEmit
pnpm build          # production build (needs no runtime secret — by design)
pnpm seed           # demo data
pnpm db:generate    # new migration after editing schema.ts
npx tsx scripts/probe-smoke.mts   # hits real endpoints; not part of pnpm test
```

The interesting logic is deliberately pure and unit-tested: probe assertions, heartbeat
deadline arithmetic, percentile and SLO-budget maths, grade monotonicity, the incident
state machine, and webhook signing.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## Licence

MIT. See [LICENSE](LICENSE).
