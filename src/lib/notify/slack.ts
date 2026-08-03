import { postJson } from "./post";
import { renderSlack } from "./render";
import type { AlertPayload, DeliveryResult, SlackConfig } from "./types";

/**
 * Slack incoming webhook.
 *
 * Slack answers a bad request with a bare `text/plain` word — `invalid_payload`,
 * `channel_not_found`, `no_service` — and nothing else. Those words are the whole
 * diagnosis, so they are surfaced verbatim rather than folded into a status code.
 */
export async function deliverSlack(
  config: SlackConfig,
  payload: AlertPayload,
): Promise<DeliveryResult> {
  return postJson({
    url: config.webhookUrl,
    body: renderSlack(payload),
    describeFailure: (status, text) => {
      if (status === 404 || text === "no_service") {
        return "Webhook not found — it was deleted or the app was uninstalled";
      }
      if (text === "invalid_payload") {
        return "Slack rejected the message payload";
      }
      if (text === "channel_not_found") {
        return "That channel no longer exists";
      }
      return `HTTP ${status}${text ? `: ${text}` : ""}`;
    },
  });
}

/**
 * Slack webhook URLs carry their credential in the path, so the whole URL is the
 * secret. Show only enough to tell two of them apart.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    const segments = pathname.split("/").filter(Boolean);
    const head = segments.slice(0, -1).join("/");
    return `${host}/${head}${head ? "/" : ""}${"•".repeat(10)}`;
  } catch {
    return "unreadable URL";
  }
}
