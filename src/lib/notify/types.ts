import { z } from "zod";
import type { ChannelKind } from "@/lib/db/schema";

/** What happened. Also the `event` field in the webhook payload. */
export type AlertEvent =
  | "monitor.down"
  | "monitor.up"
  | "monitor.degraded"
  | "monitor.acknowledged"
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

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

export const configSchemas = {
  webhook: webhookConfigSchema,
  telegram: telegramConfigSchema,
} as const satisfies Record<ChannelKind, z.ZodTypeAny>;

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  webhook: "Webhook",
  telegram: "Telegram",
};

export const CHANNEL_HINT: Record<ChannelKind, string> = {
  webhook:
    "Signed JSON POST with retries. The escape hatch that makes every other integration someone else's problem.",
  telegram: "Bot message to a chat or channel. Fastest path to a phone buzzing.",
};

/** Retry schedule. Total worst case ~10s, so a tick is never held up for long. */
export const RETRY_DELAYS_MS = [500, 2_000, 7_500] as const;
export const DELIVERY_TIMEOUT_MS = 8_000;
