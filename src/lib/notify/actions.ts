"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, CHANNEL_KINDS, type ChannelKind } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { testChannel } from "./index";
import {
  discordConfigSchema,
  emailConfigSchema,
  slackConfigSchema,
  telegramConfigSchema,
  webhookConfigSchema,
} from "./types";
import { formBool, formString, formTrimmed } from "@/lib/forms";

/**
 * Recipients arrive as one field holding commas, newlines, or both, because
 * asking someone to add three separate inputs for three addresses is worse than
 * splitting on the separators they were going to use anyway.
 */
function parseRecipients(raw: string): string[] {
  return [...new Set(raw.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean))];
}

/** Is this URL served by one of the hosts the provider actually uses? */
function hostMatches(raw: string, allowed: string[]): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return allowed.some((a) => host === a || host.endsWith(`.${a}`));
  } catch {
    return false;
  }
}

export interface ChannelActionState {
  error?: string;
  ok?: boolean;
  /**
   * The generated webhook signing secret, returned once on creation.
   *
   * Whoever writes the receiver needs this value, and the UI otherwise shows only a
   * masked prefix — so without surfacing it here the channel would be impossible to
   * verify against. Same one-time-display contract as an invite link.
   */
  secret?: string;
  /** Set after a test send, so the UI can report the outcome inline. */
  testResult?: { ok: boolean; message: string };
}

export async function createChannelAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireAdmin();

  const name = formTrimmed(formData, "name");
  const kind = formString(formData, "kind") as ChannelKind;

  if (!name) return { error: "Give the channel a name" };
  if (!CHANNEL_KINDS.includes(kind)) return { error: "Pick a channel type" };

  let config: unknown;
  let generatedSecret: string | undefined;

  /*
   * One builder per kind. Each returns the raw shape for its zod schema plus the
   * message to show when validation fails — a generic "invalid config" would
   * leave someone guessing which of six SMTP fields is wrong.
   */
  switch (kind) {
    case "webhook": {
      // Minted server-side rather than typed by the user: a secret the browser chose
      // is a secret the browser's history remembers.
      generatedSecret = randomBytes(24).toString("base64url");
      const parsed = webhookConfigSchema.safeParse({
        url: formTrimmed(formData, "url"),
        secret: generatedSecret,
      });
      if (!parsed.success) {
        return { error: "Enter a valid https:// URL for the webhook" };
      }
      config = parsed.data;
      break;
    }

    case "telegram": {
      const parsed = telegramConfigSchema.safeParse({
        botToken: formTrimmed(formData, "botToken"),
        chatId: formTrimmed(formData, "chatId"),
        silent: formBool(formData, "silent"),
      });
      if (!parsed.success) {
        return {
          error:
            "A bot token and a chat id are both required. Talk to @BotFather to create a bot.",
        };
      }
      config = parsed.data;
      break;
    }

    case "email": {
      const recipients = parseRecipients(formString(formData, "to"));
      if (recipients.length === 0) {
        return { error: "Add at least one recipient address" };
      }

      const parsed = emailConfigSchema.safeParse({
        host: formTrimmed(formData, "host"),
        port: Number(formTrimmed(formData, "port", "587")),
        secure: formBool(formData, "secure"),
        user: formTrimmed(formData, "user") || undefined,
        pass: formString(formData, "pass") || undefined,
        from: formTrimmed(formData, "from"),
        to: recipients,
      });
      if (!parsed.success) {
        return {
          error:
            "Check the SMTP host, port, and the from address — all three are required.",
        };
      }
      config = parsed.data;
      break;
    }

    case "slack":
    case "discord": {
      const url = formTrimmed(formData, "webhookUrl");
      const schema = kind === "slack" ? slackConfigSchema : discordConfigSchema;
      const parsed = schema.safeParse({ webhookUrl: url });

      if (!parsed.success) return { error: "Enter a valid webhook URL" };

      // A Slack URL pasted into a Discord channel produces a 404 during the first
      // real outage. The host check is cheap and catches it at setup instead.
      const allowed =
        kind === "slack"
          ? ["hooks.slack.com"]
          : ["discord.com", "discordapp.com"];
      if (!hostMatches(url, allowed)) {
        return {
          error:
            kind === "slack"
              ? "That is not a Slack incoming-webhook URL — it should start https://hooks.slack.com/services/"
              : "That is not a Discord webhook URL — it should start https://discord.com/api/webhooks/",
        };
      }
      config = parsed.data;
      break;
    }

    default: {
      const exhaustive: never = kind;
      return { error: `Unsupported channel type: ${String(exhaustive)}` };
    }
  }

  db.insert(channels)
    .values({
      name,
      kind,
      config: JSON.stringify(config),
      notifyOnRecovery: formData.get("notifyOnRecovery") !== null,
      notifyOnDegraded: formData.get("notifyOnDegraded") !== null,
    })
    .run();

  revalidatePath("/channels");
  return { ok: true, secret: generatedSecret };
}

/**
 * Re-issue a webhook's signing secret.
 *
 * The only way to recover from a lost secret, since the UI shows a masked prefix and
 * nothing reveals the stored value. Deliveries signed with the old secret will start
 * failing verification immediately, which is the point.
 */
export async function rotateWebhookSecretAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireAdmin();
  const id = formString(formData, "id");

  const channel = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!channel || channel.kind !== "webhook") {
    return { error: "Not a webhook channel" };
  }

  const existing = webhookConfigSchema.safeParse(safeJson(channel.config));
  if (!existing.success) return { error: "This channel's config is unreadable" };

  const secret = randomBytes(24).toString("base64url");
  db.update(channels)
    .set({ config: JSON.stringify({ ...existing.data, secret }) })
    .where(eq(channels.id, id))
    .run();

  revalidatePath("/channels");
  return { ok: true, secret };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function testChannelAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireAdmin();
  const id = formString(formData, "id");
  if (!id) return { error: "Missing channel" };

  const result = await testChannel(id);
  revalidatePath("/channels");

  return {
    testResult: {
      ok: result.ok,
      message: result.ok
        ? `Delivered in ${result.durationMs}ms`
        : (result.error ?? "Delivery failed"),
    },
  };
}

export async function toggleChannelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  const channel = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!channel) return;

  db.update(channels)
    .set({ enabled: !channel.enabled })
    .where(eq(channels.id, id))
    .run();
  revalidatePath("/channels");
}

export async function deleteChannelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  // monitor_channels rows cascade from the schema.
  if (id) db.delete(channels).where(eq(channels.id, id)).run();
  revalidatePath("/channels");
  revalidatePath("/monitors");
}
