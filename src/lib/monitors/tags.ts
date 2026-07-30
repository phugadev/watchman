/**
 * Monitor tags — free-form labels for grouping and filtering a fleet.
 *
 * Pure and free of node:/database imports, so the form and the server action normalise
 * identically. A tag that reads as "Prod" in one place and "prod" in another would split
 * a filter in half without ever looking wrong.
 */

/** Beyond this a tag is a description, not a label. */
export const MAX_TAG_LENGTH = 32;
/** Enough to express environment, team, and tier without becoming a folksonomy. */
export const MAX_TAGS = 10;

/**
 * Normalise one tag: trimmed, lowercased, internal whitespace collapsed to single
 * spaces. Lowercasing is what makes filtering predictable — "Prod" and "prod" must be
 * the same tag or the feature quietly lies.
 */
function normalise(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
}

/**
 * Parse the comma-separated form field into a clean, de-duplicated list.
 *
 * Order of first appearance is preserved rather than sorted, so the field reads back the
 * way it was typed — sorting on save makes the input feel like it is fighting you.
 */
export function parseTags(input: string | null | undefined): string[] {
  if (!input) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of input.split(",")) {
    const tag = normalise(part);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }

  return out;
}

/** Read the stored JSON array back, tolerating anything hand-edited into the column. */
export function readTags(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === "string")
      .map(normalise)
      .filter(Boolean)
      .slice(0, MAX_TAGS);
  } catch {
    // A malformed blob is a hand-edit, not a reason to fail the page.
    return [];
  }
}

/** Serialise for storage. Null rather than "[]" so "no tags" is one value, not two. */
export function serialiseTags(tags: readonly string[]): string | null {
  return tags.length === 0 ? null : JSON.stringify(tags);
}

/** Render back into the comma-separated form field. */
export function formatTags(json: string | null | undefined): string {
  return readTags(json).join(", ");
}

/** Every distinct tag across a set of monitors, sorted for a stable filter bar. */
export function collectTags(
  monitors: readonly { tags: string | null }[],
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of monitors) {
    for (const tag of readTags(m.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
