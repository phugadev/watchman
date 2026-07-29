import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites } from "@/lib/db/schema";
import { hashToken } from "./password";

/**
 * Lives outside actions.ts because a `"use server"` module may only export async
 * functions — every export there becomes a callable server-action endpoint. This
 * is a plain read helper for server components, not an action.
 */
export function findUsableInvite(token: string) {
  if (!token) return null;

  const invite = db
    .select()
    .from(invites)
    .where(
      and(eq(invites.tokenHash, hashToken(token)), isNull(invites.acceptedAt)),
    )
    .get();

  if (!invite) return null;
  if (invite.expiresAt.getTime() < Date.now()) return null;
  return invite;
}
