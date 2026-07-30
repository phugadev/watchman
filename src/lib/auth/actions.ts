"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { invites, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { newSecretToken } from "@/lib/ids";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { findUsableInvite } from "./invites";
import { hashPassword, hashToken, verifyPassword } from "./password";
import { validatePassword } from "./policy";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  getCurrentUser,
  needsSetup,
  requireAdmin,
} from "./session";
import { formString, formTrimmed } from "@/lib/forms";

export interface ActionState {
  error?: string;
  ok?: boolean;
  /** Set by createInvite — the join URL, shown exactly once. */
  inviteUrl?: string;
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(320)
  .email("Enter a valid email address");

async function clientKey(scope: string): Promise<string> {
  const hdrs = await headers();
  // Behind a reverse proxy the socket address is the proxy, so prefer the
  // forwarded chain's first hop.
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "local";
  return `${scope}:${ip}`;
}

/* ---------------------------------------------------------------------------
 * First-run setup
 * ------------------------------------------------------------------------- */

export async function setupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Guard against a race: two browsers on /setup must not both create an admin.
  if (!needsSetup()) return { error: "Watchman is already set up" };

  const name = formTrimmed(formData, "name");
  const emailResult = emailSchema.safeParse(formData.get("email"));
  const password = formString(formData, "password");

  if (!name) return { error: "Name is required" };
  if (!emailResult.success) {
    return { error: emailResult.error.issues[0]?.message ?? "Invalid email" };
  }
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError };

  const userId = db
    .insert(users)
    .values({
      name,
      email: emailResult.data,
      passwordHash: await hashPassword(password),
      role: "admin",
    })
    .returning({ id: users.id })
    .get()?.id;

  if (!userId) return { error: "Could not create the account" };

  await createSession(userId);
  redirect("/dashboard");
}

/* ---------------------------------------------------------------------------
 * Sign in / out
 * ------------------------------------------------------------------------- */

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const key = await clientKey("login");
  // 10 attempts per 15 minutes per IP. Slow enough to stop credential stuffing,
  // loose enough that a person mistyping a password is not locked out.
  const limit = rateLimit(key, 10, 15 * 60_000);
  if (!limit.ok) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)}m.`,
    };
  }

  const email = formString(formData, "email")
    .trim()
    .toLowerCase();
  const password = formString(formData, "password");

  const user = db.select().from(users).where(eq(users.email, email)).get();

  // One message for both an unknown email and a wrong password: distinguishing
  // them would turn the login form into an account-enumeration oracle.
  const invalid = { error: "Incorrect email or password" };
  if (!user) {
    // Still spend the hashing time, so response latency does not reveal whether
    // the address exists.
    await verifyPassword(
      password,
      "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA",
    );
    return invalid;
  }

  if (!(await verifyPassword(password, user.passwordHash))) return invalid;

  resetRateLimit(key);
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/* ---------------------------------------------------------------------------
 * Invites
 *
 * Watchman ships without SMTP, so invites are links rather than emails. The
 * operator copies the URL and delivers it however they like. That removes a whole
 * class of "why didn't the email arrive" support burden, and means a fresh
 * install needs no mail configuration to add a teammate.
 * ------------------------------------------------------------------------- */

export async function createInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const rawEmail = formTrimmed(formData, "email");
  const role = formData.get("role") === "admin" ? "admin" : "member";

  let email: string | null = null;
  if (rawEmail) {
    const parsed = emailSchema.safeParse(rawEmail);
    if (!parsed.success) return { error: "Enter a valid email address" };
    email = parsed.data;

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (existing) return { error: "Someone with that email already has access" };
  }

  const token = newSecretToken();
  db.insert(invites)
    .values({
      tokenHash: hashToken(token),
      email,
      role,
      createdBy: (await getCurrentUser())?.id ?? null,
      expiresAt: new Date(Date.now() + env.inviteTtlHours * 3_600_000),
    })
    .run();

  revalidatePath("/team");
  // Returned once and never stored in plaintext, so it cannot be recovered later.
  return { ok: true, inviteUrl: `${env.publicUrl}/invite/${token}` };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formString(formData, "id");
  if (id) db.delete(invites).where(eq(invites.id, id)).run();
  revalidatePath("/team");
}

export async function acceptInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formString(formData, "token");
  const name = formTrimmed(formData, "name");
  const password = formString(formData, "password");

  const limit = rateLimit(await clientKey("invite"), 20, 15 * 60_000);
  if (!limit.ok) return { error: "Too many attempts. Try again later." };

  const invite = findUsableInvite(token);
  if (!invite) return { error: "This invite is invalid or has expired" };

  if (!name) return { error: "Name is required" };
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError };

  // An invite addressed to a specific person pins the email; an open invite lets
  // the recipient choose one.
  let email = invite.email;
  if (!email) {
    const parsed = emailSchema.safeParse(formData.get("email"));
    if (!parsed.success) return { error: "Enter a valid email address" };
    email = parsed.data;
  }

  if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    return { error: "An account with that email already exists" };
  }

  const userId = db
    .insert(users)
    .values({
      name,
      email,
      passwordHash: await hashPassword(password),
      role: invite.role,
    })
    .returning({ id: users.id })
    .get()?.id;

  if (!userId) return { error: "Could not create the account" };

  db.update(invites)
    .set({ acceptedAt: new Date(), acceptedBy: userId })
    .where(eq(invites.id, invite.id))
    .run();

  await createSession(userId);
  redirect("/dashboard");
}

/* ---------------------------------------------------------------------------
 * Account management
 * ------------------------------------------------------------------------- */

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const current = formString(formData, "current");
  const next = formString(formData, "password");

  if (!(await verifyPassword(current, user.passwordHash))) {
    return { error: "Current password is incorrect" };
  }
  const passwordError = validatePassword(next);
  if (passwordError) return { error: passwordError };

  db.update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, user.id))
    .run();

  // Invalidate every other session, then re-issue one for this browser: a
  // password change is the standard response to a suspected compromise, so it has
  // to evict whoever else is signed in.
  destroyAllSessions(user.id);
  await createSession(user.id);

  return { ok: true };
}

export async function removeUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = formString(formData, "id");
  if (!id || id === admin.id) return;

  // Never leave the instance without an administrator.
  const admins = db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, "admin"))
    .get();
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (target?.role === "admin" && (admins?.n ?? 0) <= 1) return;

  db.delete(users).where(eq(users.id, id)).run();
  revalidatePath("/team");
}

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = formString(formData, "id");
  const role = formData.get("role") === "admin" ? "admin" : "member";
  if (!id) return;

  // Demoting yourself as the last admin would lock everyone out of settings.
  if (id === admin.id && role === "member") {
    const admins = db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, "admin"))
      .get();
    if ((admins?.n ?? 0) <= 1) return;
  }

  db.update(users).set({ role }).where(eq(users.id, id)).run();
  revalidatePath("/team");
}
