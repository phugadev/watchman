import { createHmac, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { env } from "@/lib/env";
import {
  DELIVERY_TIMEOUT_MS,
  type AlertPayload,
  type DeliveryResult,
  type WebhookConfig,
} from "./types";

/**
 * Signature scheme, matching the shape GitHub and Stripe use so it is already
 * familiar to whoever writes the receiver.
 *
 * The signed string is `${timestamp}.${body}` rather than the body alone. Signing
 * only the body would let anyone who captured one request replay it indefinitely;
 * including the timestamp lets the receiver reject anything older than its own
 * tolerance window.
 */
export function signWebhook(
  body: string,
  secret: string,
  timestamp: number,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

/**
 * Constant-time signature check. Exported so the docs can point receivers at a
 * reference implementation instead of leaving them to invent one.
 */
export function verifyWebhook({
  body,
  secret,
  timestamp,
  signature,
  toleranceSec = 300,
  now = Date.now(),
}: {
  body: string;
  secret: string;
  timestamp: number;
  signature: string;
  toleranceSec?: number;
  now?: number;
}): boolean {
  if (Math.abs(now / 1000 - timestamp) > toleranceSec) return false;

  const expected = Buffer.from(signWebhook(body, secret, timestamp), "utf8");
  const actual = Buffer.from(signature.replace(/^sha256=/, ""), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function deliverWebhook(
  config: WebhookConfig,
  payload: AlertPayload,
): Promise<DeliveryResult> {
  const started = performance.now();
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": env.userAgent,
        "x-watchman-event": payload.event,
        "x-watchman-timestamp": String(timestamp),
        "x-watchman-signature": `sha256=${signWebhook(body, config.secret, timestamp)}`,
        // Lets a receiver discard duplicates from a retry it already processed.
        "x-watchman-delivery": `${payload.monitor.id}-${payload.timestamp}`,
        ...(config.headers ?? {}),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      redirect: "follow",
    });

    const durationMs = Math.round(performance.now() - started);

    if (!res.ok) {
      // A short excerpt of the response body makes a misconfigured receiver far
      // easier to debug from the delivery log than a bare status code.
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200).replace(/\s+/g, " ").trim();
      } catch {
        /* body unreadable — the status alone will have to do */
      }
      return {
        ok: false,
        statusCode: res.status,
        error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        durationMs,
        attempts: 1,
      };
    }

    return { ok: true, statusCode: res.status, durationMs, attempts: 1 };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const e = err as Error & { cause?: { code?: string } };
    const reason =
      e.name === "TimeoutError" || e.name === "AbortError"
        ? `Timed out after ${DELIVERY_TIMEOUT_MS}ms`
        : (e.cause?.code ?? e.message ?? "Delivery failed");
    return { ok: false, error: reason, durationMs, attempts: 1 };
  }
}
