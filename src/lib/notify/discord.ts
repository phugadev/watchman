import { postJson } from "./post";
import { renderDiscord } from "./render";
import type { AlertPayload, DeliveryResult, DiscordConfig } from "./types";

/**
 * Discord incoming webhook.
 *
 * Success is a 204 with no body. Failures come back as JSON with a `message` and
 * a Discord-specific `code`, which is more precise than the HTTP status — a 400
 * covers both a malformed embed and an embed that is merely too long.
 */
export async function deliverDiscord(
  config: DiscordConfig,
  payload: AlertPayload,
): Promise<DeliveryResult> {
  return postJson({
    url: config.webhookUrl,
    body: renderDiscord(payload),
    describeFailure: (status, text) => {
      if (status === 401 || status === 403 || status === 404) {
        return "Webhook not found or revoked — recreate it in the channel settings";
      }

      let detail = text;
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === "string") detail = parsed.message;
      } catch {
        /* not JSON — the raw excerpt is still the best thing to show */
      }

      if (status === 429) {
        return `Rate limited by Discord${detail ? `: ${detail}` : ""}`;
      }
      return `HTTP ${status}${detail ? `: ${detail}` : ""}`;
    },
  });
}
