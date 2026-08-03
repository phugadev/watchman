import { performance } from "node:perf_hooks";
import { env } from "@/lib/env";
import { DELIVERY_TIMEOUT_MS, type DeliveryResult } from "./types";

/**
 * POST JSON to a chat provider's incoming webhook.
 *
 * Shared by Slack and Discord, which differ only in payload shape and in how they
 * word a rejection. The signed outbound webhook does not use this — it needs the
 * raw serialised body to sign, and inlining that is clearer than a hook here.
 */
export async function postJson({
  url,
  body,
  describeFailure,
}: {
  url: string;
  body: unknown;
  /** Turn a non-2xx response into an operator-readable line. */
  describeFailure: (status: number, text: string) => string;
}): Promise<DeliveryResult> {
  const started = performance.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": env.userAgent,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    const durationMs = Math.round(performance.now() - started);

    if (!res.ok) {
      let text = "";
      try {
        text = (await res.text()).slice(0, 300).replace(/\s+/g, " ").trim();
      } catch {
        /* body unreadable — the status alone will have to do */
      }
      return {
        ok: false,
        statusCode: res.status,
        error: describeFailure(res.status, text),
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
