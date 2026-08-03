import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  channels,
  monitorChannels,
  notifications,
  type Channel,
} from "@/lib/db/schema";
import { deliverDiscord } from "./discord";
import { deliverEmail } from "./email";
import { deliverSlack } from "./slack";
import { deliverTelegram } from "./telegram";
import { deliverWebhook } from "./webhook";
import {
  RETRY_DELAYS_MS,
  configSchemas,
  type AlertPayload,
  type DeliveryResult,
  type DiscordConfig,
  type EmailConfig,
  type SlackConfig,
  type TelegramConfig,
  type WebhookConfig,
} from "./types";

export * from "./types";
export {
  renderDiscord,
  renderEmailHtml,
  renderSlack,
  renderSubject,
  renderTelegram,
  renderText,
} from "./render";
export { signWebhook, verifyWebhook } from "./webhook";
export { maskBotToken } from "./telegram";
export { maskSmtpAuth } from "./email";
export { maskWebhookUrl } from "./slack";

/**
 * Route a channel to its delivery function.
 *
 * The config has already been through the matching zod schema, so the cast is
 * narrowing a validated value rather than asserting over an unknown one. The
 * `never` fallthrough makes adding a kind to CHANNEL_KINDS without wiring it a
 * compile error instead of a silent no-op during an outage.
 */
function deliver(
  kind: Channel["kind"],
  config: unknown,
  payload: AlertPayload,
): Promise<DeliveryResult> {
  switch (kind) {
    case "webhook":
      return deliverWebhook(config as WebhookConfig, payload);
    case "telegram":
      return deliverTelegram(config as TelegramConfig, payload);
    case "email":
      return deliverEmail(config as EmailConfig, payload);
    case "slack":
      return deliverSlack(config as SlackConfig, payload);
    case "discord":
      return deliverDiscord(config as DiscordConfig, payload);
    default: {
      const exhaustive: never = kind;
      return Promise.resolve({
        ok: false,
        error: `Unknown channel kind: ${String(exhaustive)}`,
        durationMs: 0,
        attempts: 0,
      });
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a delivery was for. Mirrors the `notifications.kind` column. */
export type NotificationKind =
  | "opened"
  | "resolved"
  | "degraded"
  | "acknowledged"
  | "escalated";

/**
 * Send one alert to one channel, retrying transient failures.
 *
 * For the HTTP channels, only 5xx, 429, and network-level errors are retried.
 * Retrying a 400 or 404 cannot succeed — the URL or payload is wrong — and would
 * just triple the noise in the delivery log while delaying the tick. SMTP
 * classifies its own failures, since there the 4xx/5xx meanings are reversed.
 */
async function deliverWithRetry(
  channel: Channel,
  payload: AlertPayload,
): Promise<DeliveryResult> {
  const schema = configSchemas[channel.kind];
  const parsed = schema.safeParse(safeJson(channel.config));

  if (!parsed.success) {
    return {
      ok: false,
      error: `Channel config is invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      durationMs: 0,
      attempts: 0,
    };
  }

  let last: DeliveryResult = {
    ok: false,
    error: "Not attempted",
    durationMs: 0,
    attempts: 0,
  };

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    last = await deliver(channel.kind, parsed.data, payload);

    last.attempts = attempt;
    if (last.ok) return last;

    // A channel that knows its own protocol decides for itself; the rest fall
    // back to the HTTP reading, where a 5xx is the server's problem and a 4xx is
    // ours and will not improve on the next try.
    const status = last.statusCode ?? 0;
    const retryable =
      last.retryable ?? (status === 0 || status === 429 || status >= 500);
    if (!retryable) return last;

    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (delay === undefined) break;
    await sleep(delay);
  }

  return last;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Fan an alert out to every channel attached to a monitor.
 *
 * Channels run concurrently — a Telegram outage must not delay a webhook that
 * would have worked — and each delivery is recorded regardless of outcome, so
 * "was I actually paged?" is answerable after the fact.
 */
export async function notifyMonitor({
  monitorId,
  incidentId,
  payload,
  kind,
}: {
  monitorId: string;
  incidentId?: string | null;
  payload: AlertPayload;
  kind: "opened" | "resolved" | "degraded" | "acknowledged";
}): Promise<DeliveryResult[]> {
  const rows = db
    .select({ channel: channels })
    .from(monitorChannels)
    .innerJoin(channels, eq(channels.id, monitorChannels.channelId))
    .where(eq(monitorChannels.monitorId, monitorId))
    .all();

  const targets = rows
    .map((r) => r.channel)
    .filter((c) => c.enabled)
    // Per-channel opt-outs: a pager wants outages only, a Slack-ish feed may
    // want recoveries and slowdowns too.
    .filter((c) => (kind === "resolved" ? c.notifyOnRecovery : true))
    .filter((c) => (kind === "degraded" ? c.notifyOnDegraded : true));

  if (targets.length === 0) return [];

  return Promise.all(
    targets.map(async (channel) => {
      const result = await deliverWithRetry(channel, payload);
      recordDelivery({ channel, monitorId, incidentId, kind, result });
      return result;
    }),
  );
}

/** Send a probe alert to a single channel, for the "Test" button. */
export async function testChannel(channelId: string): Promise<DeliveryResult> {
  const channel = db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .get();

  if (!channel) {
    return { ok: false, error: "Channel not found", durationMs: 0, attempts: 0 };
  }

  const payload: AlertPayload = {
    version: 1,
    event: "test",
    timestamp: new Date().toISOString(),
    monitor: {
      id: "test",
      name: "Watchman test",
      kind: "http",
      target: "https://example.com",
      url: `${process.env.WATCHMAN_URL ?? ""}/channels`,
    },
    check: { status: "up", latencyMs: 42, httpStatus: 200, error: null },
  };

  const result = await deliverWithRetry(channel, payload);
  recordDelivery({ channel, monitorId: null, incidentId: null, kind: "test", result });
  return result;
}

function recordDelivery({
  channel,
  monitorId,
  incidentId,
  kind,
  result,
}: {
  channel: Channel;
  monitorId: string | null;
  incidentId?: string | null;
  kind: "opened" | "resolved" | "degraded" | "acknowledged" | "test";
  result: DeliveryResult;
}): void {
  db.insert(notifications)
    .values({
      channelId: channel.id,
      monitorId,
      incidentId: incidentId ?? null,
      kind,
      ok: result.ok,
      attempts: result.attempts,
      statusCode: result.statusCode ?? null,
      durationMs: result.durationMs,
      error: result.error ?? null,
    })
    .run();

  // Surfaced on the channels page so a broken integration is visible without
  // digging through the delivery log.
  db.update(channels)
    .set({ lastUsedAt: new Date(), lastError: result.ok ? null : result.error })
    .where(eq(channels.id, channel.id))
    .run();
}
