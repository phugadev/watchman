export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[];

/**
 * Minimal class joiner. Watchman deliberately avoids `clsx`/`tailwind-merge`:
 * the component layer owns its base classes and callers append, so there is
 * nothing to de-duplicate.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (Array.isArray(v)) {
      const nested = cn(...v);
      if (nested) out.push(nested);
    } else {
      out.push(String(v));
    }
  }
  return out.join(" ");
}
