"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { statusPageItems, statusPages } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

export interface StatusPageActionState {
  error?: string;
  ok?: boolean;
}

/** Slugs appear in a public URL, so keep them boring and predictable. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

// Would collide with the app's own routes if allowed as a status-page slug.
const RESERVED = new Set([
  "api",
  "login",
  "setup",
  "invite",
  "dashboard",
  "monitors",
  "incidents",
  "channels",
  "status-pages",
  "team",
  "settings",
]);

export async function createStatusPageAction(
  _prev: StatusPageActionState,
  formData: FormData,
): Promise<StatusPageActionState> {
  await requireUser();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the page a title" };

  const slug = slugify(String(formData.get("slug") ?? "") || title);
  if (!slug) return { error: "That title produces an empty URL — set a slug manually" };
  if (RESERVED.has(slug)) return { error: `"${slug}" is reserved — pick another slug` };

  const existing = db
    .select({ id: statusPages.id })
    .from(statusPages)
    .where(eq(statusPages.slug, slug))
    .get();
  if (existing) return { error: `A status page already uses /status/${slug}` };

  const created = db
    .insert(statusPages)
    .values({
      slug,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      published: formData.get("published") !== null,
      showGrades: formData.get("showGrades") !== null,
      showLatency: formData.get("showLatency") !== null,
    })
    .returning({ id: statusPages.id })
    .get();

  const monitorIds = formData.getAll("monitorIds").map(String);
  if (monitorIds.length > 0) {
    db.insert(statusPageItems)
      .values(
        monitorIds.map((monitorId, i) => ({
          pageId: created.id,
          monitorId,
          sortOrder: i,
        })),
      )
      .run();
  }

  revalidatePath("/status-pages");
  revalidatePath(`/status/${slug}`);
  return { ok: true };
}

export async function updateStatusPageAction(
  _prev: StatusPageActionState,
  formData: FormData,
): Promise<StatusPageActionState> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const page = db.select().from(statusPages).where(eq(statusPages.id, id)).get();
  if (!page) return { error: "That status page no longer exists" };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the page a title" };

  db.update(statusPages)
    .set({
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      published: formData.get("published") !== null,
      showGrades: formData.get("showGrades") !== null,
      showLatency: formData.get("showLatency") !== null,
      updatedAt: new Date(),
    })
    .where(eq(statusPages.id, id))
    .run();

  // Replace the item set wholesale — simpler than diffing, and the lists are tiny.
  const monitorIds = formData.getAll("monitorIds").map(String);
  db.delete(statusPageItems).where(eq(statusPageItems.pageId, id)).run();
  if (monitorIds.length > 0) {
    db.insert(statusPageItems)
      .values(monitorIds.map((monitorId, i) => ({ pageId: id, monitorId, sortOrder: i })))
      .run();
  }

  revalidatePath("/status-pages");
  revalidatePath(`/status/${page.slug}`);
  return { ok: true };
}

export async function deleteStatusPageAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const page = db.select().from(statusPages).where(eq(statusPages.id, id)).get();
  if (!page) return;

  db.delete(statusPages).where(eq(statusPages.id, id)).run();
  revalidatePath("/status-pages");
  revalidatePath(`/status/${page.slug}`);
}

export async function togglePublishedAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const page = db.select().from(statusPages).where(eq(statusPages.id, id)).get();
  if (!page) return;

  db.update(statusPages)
    .set({ published: !page.published, updatedAt: new Date() })
    .where(eq(statusPages.id, id))
    .run();

  revalidatePath("/status-pages");
  revalidatePath(`/status/${page.slug}`);
}
