import { describe, expect, it } from "vitest";
import {
  formatHeaderLines,
  monitorFormSchema,
  parseHeaderLines,
} from "./schema";

const valid = {
  name: "API",
  kind: "http" as const,
  target: "https://api.example.com/health",
  expectedStatus: "2xx",
  intervalSec: "60",
  timeoutMs: "10000",
  confirmFailures: "2",
  confirmRecoveries: "2",
  graceSec: "120",
  sslWarnDays: "21",
  sloTargetPct: "99.9",
  method: "GET" as const,
  keywordMode: "contains" as const,
  followRedirects: true,
  verifyTls: true,
  paused: false,
  channelIds: [],
  degradedMs: null,
};

const parse = (over: Record<string, unknown> = {}) =>
  monitorFormSchema.safeParse({ ...valid, ...over });

const errorOn = (result: ReturnType<typeof parse>, field: string) =>
  result.success
    ? null
    : (result.error.issues.find((i) => i.path[0] === field)?.message ?? null);

describe("parseHeaderLines", () => {
  it("parses Name: value lines", () => {
    const r = parseHeaderLines("Authorization: Bearer abc\nX-Trace: 1");
    expect(r).toEqual({
      ok: true,
      value: { Authorization: "Bearer abc", "X-Trace": "1" },
    });
  });

  it("ignores blank lines and trims whitespace", () => {
    const r = parseHeaderLines("\n  A:  b  \n\n");
    expect(r).toEqual({ ok: true, value: { A: "b" } });
  });

  it("keeps colons inside the value", () => {
    const r = parseHeaderLines("X-Url: https://example.com:8443/x");
    expect(r).toEqual({ ok: true, value: { "X-Url": "https://example.com:8443/x" } });
  });

  it("rejects a line with no colon", () => {
    const r = parseHeaderLines("not a header");
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid header name", () => {
    const r = parseHeaderLines("Bad Header: x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not a valid header name");
  });

  it("round-trips through formatHeaderLines", () => {
    const text = "Authorization: Bearer abc\nX-Trace: 1";
    const parsed = parseHeaderLines(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(formatHeaderLines(JSON.stringify(parsed.value))).toBe(text);
    }
  });

  it("treats unparseable stored JSON as empty rather than throwing", () => {
    expect(formatHeaderLines("{not json")).toBe("");
    expect(formatHeaderLines(null)).toBe("");
  });
});

describe("monitorFormSchema", () => {
  it("accepts a well-formed HTTP monitor", () => {
    expect(parse().success).toBe(true);
  });

  it("requires a name", () => {
    expect(errorOn(parse({ name: "  " }), "name")).toBe("Name is required");
  });

  // Target rules differ per kind, which is why validation goes through superRefine.
  it("requires a parseable URL for http", () => {
    expect(errorOn(parse({ target: "" }), "target")).toBe("A URL is required");
    expect(errorOn(parse({ target: "api.example.com" }), "target")).toContain(
      "including https://",
    );
  });

  it("rejects non-http protocols", () => {
    expect(errorOn(parse({ target: "ftp://example.com" }), "target")).toContain(
      "Only http:// and https://",
    );
  });

  it("requires a port for tcp", () => {
    expect(errorOn(parse({ kind: "tcp", target: "db.internal" }), "target")).toContain(
      "Include a port",
    );
    expect(parse({ kind: "tcp", target: "db.internal:5432" }).success).toBe(true);
  });

  it("requires a hostname for ping and ssl", () => {
    expect(errorOn(parse({ kind: "ping", target: "" }), "target")).toBeTruthy();
    expect(errorOn(parse({ kind: "ssl", target: "" }), "target")).toBeTruthy();
  });

  // A heartbeat has nothing to reach — the job calls in.
  it("needs no target for a heartbeat", () => {
    expect(parse({ kind: "heartbeat", target: "" }).success).toBe(true);
  });

  it("rejects an invalid keyword regex", () => {
    const r = parse({ keyword: "([unclosed", keywordMode: "regex" });
    expect(errorOn(r, "keyword")).toContain("valid regular expression");
  });

  it("accepts a valid keyword regex", () => {
    expect(parse({ keyword: '"ok"\\s*:\\s*true', keywordMode: "regex" }).success).toBe(
      true,
    );
  });

  // A degraded threshold at or above the timeout can never fire: the check fails
  // first. Silently useless is worse than rejected.
  it("rejects a degraded threshold at or above the timeout", () => {
    expect(errorOn(parse({ degradedMs: "10000" }), "degradedMs")).toContain(
      "below the timeout",
    );
    expect(parse({ degradedMs: "9999" }).success).toBe(true);
  });

  it("enforces the interval floor", () => {
    expect(parse({ intervalSec: "9" }).success).toBe(false);
    expect(parse({ intervalSec: "10" }).success).toBe(true);
  });

  it("coerces numeric strings from FormData", () => {
    const r = parse({ intervalSec: "300", sloTargetPct: "99.95" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.intervalSec).toBe(300);
      expect(r.data.sloTargetPct).toBe(99.95);
    }
  });

  it("keeps a null degraded threshold distinct from zero", () => {
    const r = parse({ degradedMs: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.degradedMs).toBeNull();
  });
});
