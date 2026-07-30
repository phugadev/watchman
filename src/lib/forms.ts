/**
 * FormData readers.
 *
 * `FormData.get()` returns `string | File | null`, so the tempting
 * `String(data.get("title") ?? "")` is wrong for a value that is not a string: a crafted
 * multipart request can send a file part under a text field's name, and `String()` turns
 * that into the literal `"[object File]"` — which then sails through validation as a
 * perfectly ordinary non-empty string and gets stored.
 *
 * Watchman uploads nothing, so a File in any of these fields is by definition not a
 * request the UI can produce. Treating it as absent is both safer and simpler than
 * trying to interpret it.
 */

/** A text field, or the fallback when absent or not a string. */
export function formString(data: FormData, key: string, fallback = ""): string {
  const value = data.get(key);
  return typeof value === "string" ? value : fallback;
}

/** A trimmed text field. */
export function formTrimmed(data: FormData, key: string, fallback = ""): string {
  return formString(data, key, fallback).trim();
}

/**
 * A checkbox. Unchecked boxes are simply absent from the submission, which is why this
 * tests for the presence of the "on" value rather than reading a boolean.
 */
export function formBool(data: FormData, key: string): boolean {
  return data.get(key) === "on";
}

/** A repeated field — multi-select checkboxes — with non-string entries dropped. */
export function formStrings(data: FormData, key: string): string[] {
  return data.getAll(key).filter((v): v is string => typeof v === "string");
}

/**
 * An optional numeric-ish field, preserved as a string for zod to coerce.
 *
 * Returns null for a genuinely empty field so "unset" stays distinguishable from "0" —
 * the degraded-threshold input depends on that difference.
 */
export function formOptional(data: FormData, key: string): string | null {
  const value = formString(data, key);
  return value === "" ? null : value;
}
