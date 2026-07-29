import { performance } from "node:perf_hooks";
import { env } from "@/lib/env";
import { renderTelegram } from "./render";
import {
  DELIVERY_TIMEOUT_MS,
  type AlertPayload,
  type DeliveryResult,
  type TelegramConfig,
} from "./types";

/** Telegram rejects messages over 4096 characters outright. */
const MAX_MESSAGE = 4096;

interface TelegramResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export async function deliverTelegram(
  config: TelegramConfig,
  payload: AlertPayload,
): Promise<DeliveryResult> {
  const started = performance.now();
  const text = renderTelegram(payload).slice(0, MAX_MESSAGE);

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": env.userAgent,
        },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: "HTML",
          // The deep link is the last line of every alert; a link preview card
          // would bury it under a screenshot of the dashboard.
          link_preview_options: { is_disabled: true },
          disable_notification: config.silent ?? false,
        }),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      },
    );

    const durationMs = Math.round(performance.now() - started);
    let parsed: TelegramResponse | null = null;
    try {
      parsed = (await res.json()) as TelegramResponse;
    } catch {
      /* non-JSON response — fall back to the status code */
    }

    if (!res.ok || !parsed?.ok) {
      // Telegram's `description` is genuinely useful ("chat not found", "bot was
      // blocked by the user"), so surface it verbatim rather than a status code.
      const retryAfter = parsed?.parameters?.retry_after;
      return {
        ok: false,
        statusCode: res.status,
        error:
          (parsed?.description ?? `HTTP ${res.status}`) +
          (retryAfter ? ` (retry after ${retryAfter}s)` : ""),
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

/**
 * Telegram bot tokens are `<bot_id>:<secret>`. Only the id half is ever shown in
 * the UI or written to a log.
 */
export function maskBotToken(token: string): string {
  const [id] = token.split(":");
  return `${id ?? "?"}:${"•".repeat(8)}`;
}
