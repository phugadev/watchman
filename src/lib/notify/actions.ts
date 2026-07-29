"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, CHANNEL_KINDS, type ChannelKind } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { testChannel } from "./index";
import { telegramConfigSchema, webhookConfigSchema } from "./types";

export interface ChannelActionState {
  error?: string;
  ok?: boolean;
  /** Set after a test send, so the UI can report the outcome inline. */
  testResult?: { ok: boolean; message: string };
}

export async function createChannelAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "") as ChannelKind;

  if (!name) return { error: "Give the channel a name" };
  if (!CHANNEL_KINDS.includes(kind)) return { error: "Pick a channel type" };

  let config: unknown;

  if (kind === "webhook") {
    const parsed = webhookConfigSchema.safeParse({
      url: String(formData.get("url") ?? "").trim(),
      // Minted server-side and shown once. A secret the browser chose is a secret
      // the browser's history remembers.
      secret: randomBytes(24).toString("base64url"),
    });
    if (!parsed.success) {
      return { error: "Enter a valid https:// URL for the webhook" };
    }
    config = parsed.data;
  } else {
    const parsed = telegramConfigSchema.safeParse({
      botToken: String(formData.get("botToken") ?? "").trim(),
      chatId: String(formData.get("chatId") ?? "").trim(),
      silent: formData.get("silent") === "on",
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
  return { ok: true };
}

export async function testChannelAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
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
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const channel = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!channel) return;

  db.update(channels)
    .set({ enabled: !channel.enabled })
    .where(eq(channels.id, id))
    .run();
  revalidatePath("/channels");
}

export async function deleteChannelAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  // monitor_channels rows cascade from the schema.
  if (id) db.delete(channels).where(eq(channels.id, id)).run();
  revalidatePath("/channels");
  revalidatePath("/monitors");
}
