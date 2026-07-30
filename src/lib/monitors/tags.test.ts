import { describe, expect, it } from "vitest";
import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  collectTags,
  formatTags,
  parseTags,
  readTags,
  serialiseTags,
} from "./tags";

describe("parseTags", () => {
  it("splits on commas and trims", () => {
    expect(parseTags("prod, api ,tier:1")).toEqual(["prod", "api", "tier:1"]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags("  ,  , ")).toEqual([]);
  });

  // Lowercasing is what makes filtering predictable. "Prod" and "prod" filtering to
  // different sets would be a quiet lie.
  it("lowercases so filters cannot split in half", () => {
    expect(parseTags("Prod, PROD, prod")).toEqual(["prod"]);
  });

  it("collapses internal whitespace", () => {
    expect(parseTags("team   payments")).toEqual(["team payments"]);
  });

  it("de-duplicates while preserving first-seen order", () => {
    expect(parseTags("b, a, b, c, a")).toEqual(["b", "a", "c"]);
  });

  it("caps the number of tags", () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`).join(",");
    expect(parseTags(many)).toHaveLength(MAX_TAGS);
  });

  it("truncates an over-long tag rather than rejecting the whole field", () => {
    const long = "x".repeat(MAX_TAG_LENGTH + 20);
    const [tag] = parseTags(long);
    expect(tag).toHaveLength(MAX_TAG_LENGTH);
  });
});

describe("serialiseTags / readTags", () => {
  // Null rather than "[]" so "no tags" is one value in the column, not two.
  it("stores null for an empty list", () => {
    expect(serialiseTags([])).toBeNull();
  });

  it("round-trips", () => {
    const tags = ["prod", "api"];
    expect(readTags(serialiseTags(tags))).toEqual(tags);
  });

  it("reads null and empty as no tags", () => {
    expect(readTags(null)).toEqual([]);
    expect(readTags(undefined)).toEqual([]);
    expect(readTags("")).toEqual([]);
  });

  // The column is JSON text in SQLite, so it can be hand-edited into anything. A
  // malformed blob must not take a page down.
  it("survives malformed or unexpected JSON", () => {
    expect(readTags("{not json")).toEqual([]);
    expect(readTags('{"a":1}')).toEqual([]);
    expect(readTags("[1, 2, 3]")).toEqual([]);
    expect(readTags('["ok", 5, null, "fine"]')).toEqual(["ok", "fine"]);
  });

  it("re-normalises what it reads, so old rows cannot bypass the rules", () => {
    expect(readTags('["  PROD  ", "a   b"]')).toEqual(["prod", "a b"]);
  });
});

describe("formatTags", () => {
  it("renders back into the comma-separated field", () => {
    expect(formatTags('["prod","api"]')).toBe("prod, api");
    expect(formatTags(null)).toBe("");
  });

  it("survives a form round trip unchanged", () => {
    const typed = "Prod, API, prod";
    const stored = serialiseTags(parseTags(typed));
    expect(parseTags(formatTags(stored))).toEqual(["prod", "api"]);
  });
});

describe("collectTags", () => {
  const monitors = [
    { tags: '["prod","api"]' },
    { tags: '["prod","web"]' },
    { tags: '["prod"]' },
    { tags: null },
  ];

  it("counts each tag across monitors", () => {
    expect(collectTags(monitors)).toEqual([
      { tag: "prod", count: 3 },
      { tag: "api", count: 1 },
      { tag: "web", count: 1 },
    ]);
  });

  it("orders by count, then alphabetically for a stable filter bar", () => {
    const result = collectTags([{ tags: '["zebra","alpha"]' }]);
    expect(result.map((r) => r.tag)).toEqual(["alpha", "zebra"]);
  });

  it("returns nothing when no monitor is tagged", () => {
    expect(collectTags([{ tags: null }, { tags: "" }])).toEqual([]);
  });
});
