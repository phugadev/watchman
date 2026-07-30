"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, CHANNEL_KINDS, type ChannelKind } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { testChannel } from "./index";
import { telegramConfigSchema, webhookConfigSchema } from "./types";
import { formBool, formString, formTrimmed } from "@/lib/forms";

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

  if (kind === "webhook") {
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
  } else {
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
