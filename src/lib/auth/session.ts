import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { newSecretToken } from "@/lib/ids";
import { hashToken } from "./password";

export const SESSION_COOKIE = "watchman_session";

/**
 * Issue a session and set its cookie.
 *
 * Only the SHA-256 of the token is persisted, so a database that leaks — via a
 * stray backup or a mounted volume — hands over no usable sessions.
 */
export async function createSession(userId: string): Promise<void> {
  const token = newSecretToken();
  const expiresAt = new Date(
    Date.now() + env.sessionTtlDays * 86_400_000,
  );

  const hdrs = await headers();

  db.insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      expiresAt,
      userAgent: hdrs.get("user-agent")?.slice(0, 255) ?? null,
    })
    .run();

  // Opportunistic cleanup: expired rows are pruned on login rather than by a
  // dedicated job, which keeps the table small without another timer.
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // "lax" so following an invite link from email still works.
    secure: env.isProd,
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the signed-in user, or null. Safe to call from any server component. */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())),
    )
    .get();

  if (!row) return null;

  // `last_seen_at` powers the team list. Written at most once a minute so a page
  // with several server components does not issue a write per render.
  const lastSeen = row.user.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - lastSeen > 60_000) {
    db.update(users)
      .set({ lastSeenAt: new Date() })
      .where(eq(users.id, row.user.id))
      .run();
  }

  return row.user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
  }
  jar.delete(SESSION_COOKIE);
}

/** Sign out everywhere. Offered after a password change. */
export function destroyAllSessions(userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

/** True before the first account exists, which routes the app to /setup. */
export function needsSetup(): boolean {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .get();
  return (row?.n ?? 0) === 0;
}

/**
 * Gate a page on being signed in.
 *
 * An empty instance is sent to /setup rather than /login, so a fresh `docker run`
 * lands on account creation instead of a login form nobody can satisfy.
 */
export async function requireUser(): Promise<User> {
  if (needsSetup()) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Gate a page on the admin role. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}
