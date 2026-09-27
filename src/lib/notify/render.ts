import { emailPalette } from "./palette";
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
  "monitor.escalated": "STILL DOWN",
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
  "monitor.escalated": "🚨",
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

  if (p.incident?.escalation) {
    const e = p.incident.escalation;
    lines.push(
      `<b>Escalated</b> — step ${e.level} of "${escapeHtml(e.policyName)}", unacknowledged for ${formatDuration(e.unacknowledgedForMs)}`,
    );
    lines.push("");
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

/**
 * Plain-text rendering, for logs and for the text/plain half of an email.
 *
 * Anchors become "label: url" before the tags are stripped. Dropping them would
 * leave the plain part ending in a bare "Open in Watchman" with nothing to open —
 * which is exactly the part a terminal mail client or a pager gateway reads.
 */
export function renderText(p: AlertPayload): string {
  return renderTelegram(p)
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, "$2: $1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/* ---------------------------------------------------------------------------
 * Field extraction
 *
 * The three rich channels below want the same facts in three layouts, so the
 * selection of what is worth showing lives in one place. Changing what an alert
 * says should not mean editing four renderers and forgetting one.
 * ------------------------------------------------------------------------- */

export interface AlertField {
  label: string;
  value: string;
}

export function alertFields(p: AlertPayload): AlertField[] {
  const fields: AlertField[] = [];
  const cause = p.check?.error ?? p.incident?.cause;

  // On an escalation the elapsed time is the news — the cause has not changed
  // since the first alert, but "unacknowledged for 20m" is why this one arrived.
  if (p.incident?.escalation) {
    fields.push({
      label: "Unacknowledged for",
      value: formatDuration(p.incident.escalation.unacknowledgedForMs),
    });
  }

  if (cause) fields.push({ label: "Cause", value: cause });
  fields.push({ label: "Target", value: p.monitor.target || p.monitor.kind });

  if (p.event === "monitor.up" && p.incident?.durationMs != null) {
    fields.push({
      label: "Downtime",
      value: formatDuration(p.incident.durationMs),
    });
  }
  if (p.check?.latencyMs != null) {
    fields.push({ label: "Response", value: formatMs(p.check.latencyMs) });
  }
  if (p.check?.httpStatus != null) {
    fields.push({ label: "HTTP", value: String(p.check.httpStatus) });
  }
  if (p.health) {
    fields.push({
      label: "24h uptime",
      value: `${p.health.uptime24hPct.toFixed(2)}% · grade ${p.health.grade}`,
    });
  }

  return fields;
}

/**
 * Which Minima tone each event wears. An escalation is the same outage, still
 * happening, so it takes down's red; a distinct colour would suggest a
 * distinct condition. Acknowledged and test are not states that need action.
 */
const EVENT_TONE: Record<AlertPayload["event"], keyof typeof emailPalette.light.tones> = {
  "monitor.down": "down",
  "monitor.up": "up",
  "monitor.degraded": "degraded",
  "monitor.acknowledged": "neutral",
  "monitor.escalated": "down",
  test: "neutral",
};

/**
 * Accent colour per event, as a hex string, for surfaces that take one colour
 * and render it on a dark ground — Discord's embed stripe. Minima's dark mark
 * for the event's tone.
 */
export const EVENT_COLOR: Record<AlertPayload["event"], string> = Object.fromEntries(
  Object.entries(EVENT_TONE).map(([event, tone]) => [event, emailPalette.dark.tones[tone].mark]),
) as Record<AlertPayload["event"], string>;

export function eventHeadline(p: AlertPayload): string {
  return HEADLINE[p.event];
}

export function eventGlyph(p: AlertPayload): string {
  return GLYPH[p.event];
}

/* ---------------------------------------------------------------------------
 * Slack
 * ------------------------------------------------------------------------- */

/** Slack's mrkdwn escaping. Only these three are special. */
function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: { type: string; text: string }[];
  elements?: { type: string; text: string }[];
}

export interface SlackMessage {
  /** Fallback text — what a mobile push notification shows. */
  text: string;
  blocks: SlackBlock[];
}

export function renderSlack(p: AlertPayload): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${GLYPH[p.event]} *${escapeMrkdwn(HEADLINE[p.event])}* — ${escapeMrkdwn(p.monitor.name)}`,
      },
    },
  ];

  if (p.event === "test") {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "This is a test alert. If you can read this, the channel is configured correctly.",
      },
    });
  }

  // Two columns, which is what Slack's `fields` renders on a desktop and stacks
  // on a phone. Ten is the documented cap; alertFields never approaches it.
  const fields = alertFields(p).slice(0, 10);
  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields: fields.map((f) => ({
        type: "mrkdwn",
        text: `*${escapeMrkdwn(f.label)}*\n${escapeMrkdwn(f.value)}`,
      })),
    });
  }

  if (p.incident?.flapping) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "⚠️ This monitor is flapping — further alerts are suppressed until it stabilises.",
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `<${p.incident?.url ?? p.monitor.url}|Open in Watchman>`,
      },
    ],
  });

  return { text: renderSubject(p), blocks };
}

/* ---------------------------------------------------------------------------
 * Discord
 * ------------------------------------------------------------------------- */

export interface DiscordMessage {
  content?: string;
  embeds: {
    title: string;
    description?: string;
    url?: string;
    color: number;
    fields: { name: string; value: string; inline: boolean }[];
    footer?: { text: string };
    timestamp: string;
  }[];
}

export function renderDiscord(p: AlertPayload): DiscordMessage {
  const fields = alertFields(p);

  return {
    embeds: [
      {
        title: `${GLYPH[p.event]} ${HEADLINE[p.event]} — ${p.monitor.name}`,
        description:
          p.event === "test"
            ? "This is a test alert. If you can read this, the channel is configured correctly."
            : undefined,
        url: p.incident?.url ?? p.monitor.url,
        // Discord takes the stripe colour as a decimal integer.
        color: parseInt(EVENT_COLOR[p.event].slice(1), 16),
        // `Cause` can be long and reads badly in a narrow column; everything else
        // is short enough to sit two-up.
        fields: fields.slice(0, 25).map((f) => ({
          name: f.label,
          value: f.value.slice(0, 1024),
          inline: f.label !== "Cause",
        })),
        footer: p.incident?.flapping
          ? { text: "Flapping — further alerts suppressed until it stabilises" }
          : undefined,
        timestamp: p.timestamp,
      },
    ],
  };
}

/* ---------------------------------------------------------------------------
 * Email
 * ------------------------------------------------------------------------- */

/**
 * HTML email body, in Minima's colours and both of its modes.
 *
 * Email clients are not browsers. Table layout and inline styles carry the
 * light design, which every client renders — Outlook ignores most of flexbox,
 * and Gmail keeps inline styles when it drops media queries. A dark-mode block
 * then swaps in Minima's dark values for clients that honour
 * prefers-color-scheme (Apple Mail, iOS Mail); every element it touches has a
 * class for it, and !important because inline styles otherwise win. Clients
 * that force their own dark mode get a light design to invert, which is the
 * case they are built for.
 *
 * Every colour comes from palette.ts, generated from styles/minima.css.
 */
export function renderEmailHtml(p: AlertPayload): string {
  const tone = EVENT_TONE[p.event];
  const L = emailPalette.light;
  const D = emailPalette.dark;
  const t = L.tones[tone];
  const dt = D.tones[tone];
  const warn = L.tones.degraded;
  const dwarn = D.tones.degraded;
  const { panel, control } = emailPalette.radius;
  const link = p.incident?.url ?? p.monitor.url;

  const rows = alertFields(p)
    .map(
      (f) => `
        <tr>
          <td class="wm-subtle" style="padding:6px 16px 6px 0;color:${L.subtle};font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;white-space:nowrap;vertical-align:top;">${escapeHtml(f.label)}</td>
          <td class="wm-text" style="padding:6px 0;color:${L.text};font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word;">${escapeHtml(f.value)}</td>
        </tr>`,
    )
    .join("");

  const flapping = p.incident?.flapping
    ? `<p class="wm-flap" style="margin:20px 0 0;padding:12px 14px;background:${warn.fill};border:1px solid ${warn.border};border-left:3px solid ${warn.mark};border-radius:${control};color:${L.text};font-size:13px;">This monitor is flapping — further alerts are suppressed until it stabilises.</p>`
    : "";

  const intro =
    p.event === "test"
      ? `<p class="wm-muted" style="margin:0 0 20px;color:${L.muted};font-size:14px;">This is a test alert. If you can read this, the channel is configured correctly.</p>`
      : "";

  return `<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <style>
      @media (prefers-color-scheme: dark) {
        .wm-canvas { background:${D.canvas} !important; }
        .wm-card { background:${D.card} !important; border-color:${D.border} !important; }
        .wm-stripe { background:${dt.mark} !important; }
        .wm-accent { color:${dt.text} !important; }
        .wm-text { color:${D.text} !important; }
        .wm-muted { color:${D.muted} !important; }
        .wm-subtle { color:${D.subtle} !important; }
        .wm-button { background:${dt.solid} !important; color:${dt.onSolid} !important; }
        .wm-flap { background:${dwarn.fill} !important; border-color:${dwarn.border} !important; border-left-color:${dwarn.mark} !important; color:${D.text} !important; }
      }
    </style>
  </head>
  <body class="wm-canvas" style="margin:0;padding:24px;background:${L.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" class="wm-card" style="width:100%;max-width:560px;margin:0 auto;background:${L.card};border:1px solid ${L.border};border-radius:${panel};border-collapse:separate;overflow:hidden;">
      <tr>
        <td class="wm-stripe" style="height:3px;background:${t.mark};font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p class="wm-accent" style="margin:0 0 4px;color:${t.text};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;">${escapeHtml(HEADLINE[p.event])}</p>
          <h1 class="wm-text" style="margin:0 0 20px;color:${L.text};font-size:20px;font-weight:600;">${escapeHtml(p.monitor.name)}</h1>
          ${intro}
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>
          ${flapping}
          <p style="margin:24px 0 0;">
            <a href="${escapeHtml(link)}" class="wm-button" style="display:inline-block;padding:10px 18px;background:${t.solid};color:${t.onSolid};border-radius:${control};font-size:14px;font-weight:600;text-decoration:none;">Open in Watchman</a>
          </p>
        </td>
      </tr>
    </table>
    <p class="wm-subtle" style="margin:16px auto 0;max-width:560px;color:${L.subtle};font-size:12px;text-align:center;">
      Sent by Watchman · ${escapeHtml(p.monitor.url.replace(/\/monitors\/.*$/, ""))}
    </p>
  </body>
</html>`;
}
