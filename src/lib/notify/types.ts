import { z } from "zod";
import type { ChannelKind } from "@/lib/db/schema";

/** What happened. Also the `event` field in the webhook payload. */
export type AlertEvent =
  | "monitor.down"
  | "monitor.up"
  | "monitor.degraded"
  | "monitor.acknowledged"
  | "monitor.escalated"
  | "test";

/**
 * The alert body. Stable, versioned, and identical across channels — Telegram
 * renders it as prose, webhooks receive it as JSON, and anything added later
 * consumes the same shape.
 */
export interface AlertPayload {
  version: 1;
  event: AlertEvent;
  /** ISO-8601, UTC. */
  timestamp: string;
  monitor: {
    id: string;
    name: string;
    kind: string;
    target: string;
    /** Deep link into this Watchman instance. */
    url: string;
  };
  incident?: {
    id: string;
    startedAt: string;
    resolvedAt?: string | null;
    /** Present on recovery: how long the outage lasted. */
    durationMs?: number | null;
    cause?: string | null;
    flapping?: boolean;
    url: string;
    /** Present on an escalation: which step fired, and how long it has been open. */
    escalation?: {
      level: number;
      policyName: string;
      unacknowledgedForMs: number;
    };
  };
  check?: {
    status: string;
    latencyMs?: number | null;
    httpStatus?: number | null;
    error?: string | null;
  };
  /** Rolling health, so an alert carries context without a round trip. */
  health?: {
    grade: string;
    uptime24hPct: number;
    p95Ms?: number | null;
  };
}

export interface DeliveryResult {
  ok: boolean;
  statusCode?: number | null;
  error?: string | null;
  durationMs: number;
  attempts: number;
  /**
   * Whether another attempt could plausibly succeed.
   *
   * Left unset by the HTTP channels, where the status code answers it. SMTP sets
   * it explicitly, because there the convention is inverted — a 4xx reply is the
   * transient one and 5xx is permanent, so the HTTP heuristic would retry a
   * rejected recipient three times and give up on a greylisted one.
   */
  retryable?: boolean;
}

/* ---------------------------------------------------------------------------
 * Channel configuration
 *
 * Config is stored as JSON text in SQLite, so it is parsed through zod at every
 * read. Hand-edited or migrated rows cannot crash the notifier.
 * ------------------------------------------------------------------------- */

export const webhookConfigSchema = z.object({
  url: z.string().url(),
  /** Shared secret for the HMAC signature. Generated when the channel is created. */
  secret: z.string().min(16),
  /** Extra static headers, for gateways that want an auth token. */
  headers: z.record(z.string(), z.string()).optional(),
});

export const telegramConfigSchema = z.object({
  botToken: z.string().min(20),
  chatId: z.string().min(1),
  /** Send silently — useful for a low-priority recovery channel. */
  silent: z.boolean().optional(),
});

/**
 * SMTP.
 *
 * Credentials are optional because a good number of self-hosted setups relay
 * through an unauthenticated MTA on the same host or LAN. Requiring a username
 * would make the form lie about what SMTP needs.
 */
export const emailConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  /**
   * Implicit TLS, the whole session wrapped (port 465). When false the connection
   * starts in the clear and is upgraded with STARTTLS, which is what 587 expects.
   */
  secure: z.boolean().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
  from: z.string().min(3),
  /** At least one recipient, or the channel is a no-op that reports success. */
  to: z.array(z.string().min(3)).min(1),
});

/**
 * Slack and Discord both take an incoming-webhook URL and nothing else, but they
 * are separate kinds rather than one "chat" kind: the message formats have
 * nothing in common, and a URL pasted into the wrong one fails at 3am rather
 * than at setup.
 */
export const slackConfigSchema = z.object({
  webhookUrl: z.string().url(),
});

export const discordConfigSchema = z.object({
  webhookUrl: z.string().url(),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export type EmailConfig = z.infer<typeof emailConfigSchema>;
export type SlackConfig = z.infer<typeof slackConfigSchema>;
export type DiscordConfig = z.infer<typeof discordConfigSchema>;

export const configSchemas = {
  webhook: webhookConfigSchema,
  telegram: telegramConfigSchema,
  email: emailConfigSchema,
  slack: slackConfigSchema,
  discord: discordConfigSchema,
} as const satisfies Record<ChannelKind, z.ZodTypeAny>;

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  webhook: "Webhook",
  telegram: "Telegram",
  email: "Email",
  slack: "Slack",
  discord: "Discord",
};

export const CHANNEL_HINT: Record<ChannelKind, string> = {
  webhook:
    "Signed JSON POST with retries. The escape hatch that makes every other integration someone else's problem.",
  telegram: "Bot message to a chat or channel. Fastest path to a phone buzzing.",
  email:
    "SMTP to one or more addresses. Reaches people who are not in your chat tool, and survives it being the thing that is down.",
  slack: "Incoming webhook, rendered as a Slack message rather than a JSON blob.",
  discord: "Incoming webhook, rendered as an embed with the status in the stripe.",
};

/** Retry schedule. Total worst case ~10s, so a tick is never held up for long. */
export const RETRY_DELAYS_MS = [500, 2_000, 7_500] as const;
export const DELIVERY_TIMEOUT_MS = 8_000;
