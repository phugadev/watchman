import { formatDuration, formatMs } from "@/lib/metrics/uptime";
import type { AlertPayload } from "./types";

/** Escape for Telegram's HTML parse mode, which only permits a small tag set. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HEADLINE: Record<AlertPayload["event"], string> = {
  "monitor.down": "DOWN",
  "monitor.up": "RECOVERED",
  "monitor.degraded": "DEGRADED",
  "monitor.acknowledged": "ACKNOWLEDGED",
  test: "TEST",
};

/**
 * A leading glyph, because an alert is usually read on a phone lock screen where
 * the first character does more work than the next forty.
 */
const GLYPH: Record<AlertPayload["event"], string> = {
  "monitor.down": "🔴",
  "monitor.up": "🟢",
  "monitor.degraded": "🟡",
  "monitor.acknowledged": "👁",
  test: "⚪️",
};

/** One-line summary, used as the notification title and for logs. */
export function renderSubject(p: AlertPayload): string {
  if (p.event === "test") return `Watchman test alert — ${p.monitor.name}`;
  return `${HEADLINE[p.event]}: ${p.monitor.name}`;
}

/**
 * Telegram message body.
 *
 * Structured so the essentials — what broke, why, how long — survive being
 * truncated in a notification preview, with the deep link last.
 */
export function renderTelegram(p: AlertPayload): string {
  const lines: string[] = [];

  lines.push(
    `${GLYPH[p.event]} <b>${escapeHtml(HEADLINE[p.event])}</b> — ${escapeHtml(p.monitor.name)}`,
  );
  lines.push("");

  if (p.event === "test") {
    lines.push(
      "This is a test alert. If you can read this, the channel is configured correctly.",
    );
  }

  if (p.check?.error) {
    lines.push(`<b>Cause:</b> ${escapeHtml(p.check.error)}`);
  } else if (p.incident?.cause) {
    lines.push(`<b>Cause:</b> ${escapeHtml(p.incident.cause)}`);
  }

  lines.push(
    `<b>Target:</b> <code>${escapeHtml(p.monitor.target || p.monitor.kind)}</code>`,
  );

  if (p.event === "monitor.up" && p.incident?.durationMs != null) {
    lines.push(`<b>Downtime:</b> ${formatDuration(p.incident.durationMs)}`);
  }

  if (p.check?.latencyMs != null) {
    lines.push(`<b>Response:</b> ${formatMs(p.check.latencyMs)}`);
  }

  if (p.check?.httpStatus != null) {
    lines.push(`<b>HTTP:</b> ${p.check.httpStatus}`);
  }

  if (p.health) {
    lines.push(
      `<b>24h:</b> ${p.health.uptime24hPct.toFixed(2)}% · grade ${escapeHtml(p.health.grade)}`,
    );
  }

  if (p.incident?.flapping) {
    lines.push("");
    lines.push(
      "⚠️ <i>This monitor is flapping — further alerts are suppressed until it stabilises.</i>",
    );
  }

  lines.push("");
  lines.push(
    `<a href="${escapeHtml(p.incident?.url ?? p.monitor.url)}">Open in Watchman</a>`,
  );

  return lines.join("\n");
}

/** Plain-text rendering, for logs and future channels. */
export function renderText(p: AlertPayload): string {
  return renderTelegram(p)
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
