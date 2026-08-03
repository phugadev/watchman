import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { Code, KeyValue, MonoLabel } from "@/components/ui/mono";
import {
  NewChannelForm,
  RotateSecretButton,
  TestChannelButton,
} from "@/components/channels/channel-forms";
import { requireUser } from "@/lib/auth/session";
import { formatAgo, formatMs } from "@/lib/metrics/uptime";
import {
  deleteChannelAction,
  toggleChannelAction,
} from "@/lib/notify/actions";
import {
  CHANNEL_LABEL,
  maskBotToken,
  maskSmtpAuth,
  maskWebhookUrl,
} from "@/lib/notify";
import { listChannels, listRecentDeliveries } from "@/lib/queries";

export const metadata: Metadata = { title: "Alert channels" };
export const dynamic = "force-dynamic";

/** Render a channel's config for display, never leaking a full credential. */
function describeConfig(kind: string, raw: string): { label: string; value: string }[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [{ label: "config", value: "unreadable" }];
  }

  // The blob is hand-editable text in SQLite, so a field could be any JSON type.
  // String() on an object would render "[object Object]" as though it were the value.
  const str = (v: unknown, fallback = "—") =>
    typeof v === "string" ? v : fallback;

  switch (kind) {
    case "webhook":
      return [
        { label: "endpoint", value: str(parsed.url) },
        // Only a prefix: enough to tell two channels apart, useless to an attacker.
        {
          label: "signing secret",
          value: `${str(parsed.secret, "").slice(0, 6)}${"•".repeat(12)}`,
        },
      ];

    case "email": {
      const to = Array.isArray(parsed.to)
        ? parsed.to.filter((v): v is string => typeof v === "string")
        : [];
      return [
        {
          label: "server",
          value: `${str(parsed.host)}:${typeof parsed.port === "number" ? parsed.port : "?"}${parsed.secure === true ? " · TLS" : ""}`,
        },
        { label: "auth", value: maskSmtpAuth(str(parsed.user, "")) },
        { label: "from", value: str(parsed.from) },
        {
          // The full list of a dozen addresses would push everything else off the
          // card; the count is what you check, the first one identifies it.
          label: "to",
          value:
            to.length === 0
              ? "—"
              : to.length === 1
                ? to[0]!
                : `${to[0]!} +${to.length - 1} more`,
        },
      ];
    }

    case "slack":
    case "discord":
      // The whole URL is the credential — it carries no user-identifying part, so
      // there is nothing to show but enough of the host to confirm the provider.
      return [{ label: "webhook", value: maskWebhookUrl(str(parsed.webhookUrl, "")) }];

    default:
      return [
        { label: "bot", value: maskBotToken(str(parsed.botToken, "")) },
        { label: "chat", value: str(parsed.chatId) },
      ];
  }
}

export default async function ChannelsPage() {
  // Members can see how alerting is wired and whether deliveries are landing —
  // useful during an incident — but only admins can change it. Channels hold
  // credentials and decide whether anyone gets paged at all.
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const rows = listChannels();
  const deliveries = listRecentDeliveries(25);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader label="alert channels">
        {isAdmin ? <NewChannelForm /> : <MonoLabel tone="slate">read only</MonoLabel>}
      </SectionHeader>

      {rows.length === 0 ? (
        <EmptyState
          title="no alert channels"
          hint="Without a channel, Watchman records outages but tells nobody. Email reaches people who are not in your chat tool; Slack, Discord, and Telegram are the fastest path to a phone buzzing; a webhook makes every other integration someone else's problem."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map(({ channel, monitorCount }) => (
            <Panel key={channel.id} inset className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={
                        channel.enabled ? "size-2 shrink-0 bg-live" : "size-2 shrink-0 bg-slate"
                      }
                      aria-hidden
                    />
                    <span className="truncate text-[14px] font-medium text-bone">
                      {channel.name}
                    </span>
                  </div>
                  <MonoLabel tone="slate">
                    {CHANNEL_LABEL[channel.kind]} · {monitorCount} monitor
                    {monitorCount === 1 ? "" : "s"}
                  </MonoLabel>
                </div>

                {isAdmin ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <form action={toggleChannelAction}>
                      <input type="hidden" name="id" value={channel.id} />
                      <Button type="submit" variant="bracket" size="sm">
                        {channel.enabled ? "disable" : "enable"}
                      </Button>
                    </form>
                    <form action={deleteChannelAction}>
                      <input type="hidden" name="id" value={channel.id} />
                      <Button
                        type="submit"
                        variant="bracket"
                        size="sm"
                        className="hover:text-alarm"
                      >
                        delete
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>

              <Rule />

              <div className="flex flex-col">
                {describeConfig(channel.kind, channel.config).map((row) => (
                  <KeyValue key={row.label} k={row.label}>
                    <span className="break-all">{row.value}</span>
                  </KeyValue>
                ))}
                <KeyValue k="on recovery">{channel.notifyOnRecovery ? "yes" : "no"}</KeyValue>
                <KeyValue k="on degraded">{channel.notifyOnDegraded ? "yes" : "no"}</KeyValue>
                <KeyValue k="last used">{formatAgo(channel.lastUsedAt)}</KeyValue>
              </div>

              {channel.lastError ? (
                <p className="break-words border-l-2 border-alarm/40 pl-2 font-mono text-[10px] text-alarm">
                  {channel.lastError}
                </p>
              ) : null}

              {isAdmin ? (
                <>
                  <Rule />
                  <div className="flex flex-col gap-3">
                    <TestChannelButton channelId={channel.id} />
                    {channel.kind === "webhook" ? (
                      <RotateSecretButton channelId={channel.id} />
                    ) : null}
                  </div>
                </>
              ) : null}
            </Panel>
          ))}
        </div>
      )}

      {/* ---- webhook contract -------------------------------------------
           Documented in the app, not just the README: whoever writes the
           receiver is usually looking at this screen. */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="webhook contract" />
        <Panel inset className="flex flex-col gap-4">
          <p className="max-w-2xl text-[13px] leading-relaxed text-ash">
            Watchman sends a <Code>POST</Code> with a JSON body and these headers.
            Verify the signature before trusting the payload: it is an HMAC-SHA256
            over <Code>{"`${timestamp}.${body}`"}</Code>, hex encoded. The timestamp
            is inside the signed string so a captured request cannot be replayed —
            reject anything older than five minutes.
          </p>
          <div className="flex flex-col">
            <KeyValue k="x-watchman-event">monitor.down · monitor.up · monitor.degraded · test</KeyValue>
            <KeyValue k="x-watchman-timestamp">unix seconds</KeyValue>
            <KeyValue k="x-watchman-signature">sha256=&lt;hex&gt;</KeyValue>
            <KeyValue k="x-watchman-delivery">idempotency key</KeyValue>
          </div>
          <pre className="overflow-x-auto border border-hairline-soft bg-void px-3 py-2.5 font-mono text-[11px] leading-relaxed text-bone">
{`const expected = crypto
  .createHmac("sha256", SECRET)
  .update(\`\${req.headers["x-watchman-timestamp"]}.\${rawBody}\`)
  .digest("hex");

if (!crypto.timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(req.headers["x-watchman-signature"].replace("sha256=", "")),
)) return res.status(401).end();`}
          </pre>
        </Panel>
      </section>

      {/* ---- delivery log ------------------------------------------------ */}
      {deliveries.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader label="recent deliveries" />
          <Panel className="divide-y divide-hairline-soft">
            {deliveries.map(({ notification, channelName, monitorName }) => (
              <div
                key={notification.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 font-mono text-[11px]"
              >
                <span
                  className={
                    notification.ok ? "size-1.5 shrink-0 bg-live" : "size-1.5 shrink-0 bg-alarm"
                  }
                  aria-hidden
                />
                <span className="w-32 shrink-0 tnum text-slate">
                  {notification.at.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="w-36 shrink-0 truncate text-ash">{channelName}</span>
                <span className="w-40 shrink-0 truncate text-slate">
                  {monitorName ?? "—"}
                </span>
                <span className="w-16 shrink-0 text-slate">{notification.kind}</span>
                {notification.attempts > 1 ? (
                  <span className="shrink-0 text-warn">×{notification.attempts}</span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-alarm">
                  {notification.error ?? ""}
                </span>
                <span className="shrink-0 tnum text-slate">
                  {formatMs(notification.durationMs)}
                </span>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
