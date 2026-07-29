import { describe, expect, it } from "vitest";
import {
  applyDegraded,
  matchesExpectedStatus,
  matchesKeyword,
  parseHostPort,
} from "./assertions";

describe("matchesExpectedStatus", () => {
  it("matches exact codes", () => {
    expect(matchesExpectedStatus("200", 200)).toBe(true);
    expect(matchesExpectedStatus("200", 201)).toBe(false);
  });

  it("matches comma-separated lists with whitespace", () => {
    expect(matchesExpectedStatus("200, 201 ,204", 204)).toBe(true);
    expect(matchesExpectedStatus("200,201,204", 500)).toBe(false);
  });

  it("matches wildcard families", () => {
    expect(matchesExpectedStatus("2xx", 204)).toBe(true);
    expect(matchesExpectedStatus("2xx", 301)).toBe(false);
    expect(matchesExpectedStatus("30x", 302)).toBe(true);
    expect(matchesExpectedStatus("30x", 310)).toBe(false);
  });

  it("matches inclusive ranges in either order", () => {
    expect(matchesExpectedStatus("200-299", 299)).toBe(true);
    expect(matchesExpectedStatus("200-299", 300)).toBe(false);
    expect(matchesExpectedStatus("299-200", 250)).toBe(true);
  });

  it("mixes notations in one spec", () => {
    expect(matchesExpectedStatus("2xx,301,400-404", 403)).toBe(true);
    expect(matchesExpectedStatus("2xx,301,400-404", 405)).toBe(false);
  });

  // A blank spec must fail closed. Treating "" as "accept anything" would make a
  // monitor silently report a 500 endpoint as healthy.
  it("falls back to 2xx for empty or unparseable specs", () => {
    expect(matchesExpectedStatus("", 200)).toBe(true);
    expect(matchesExpectedStatus("", 500)).toBe(false);
    expect(matchesExpectedStatus("   ", 503)).toBe(false);
    expect(matchesExpectedStatus("garbage", 200)).toBe(false);
  });
});

describe("matchesKeyword", () => {
  it("passes when no keyword is configured", () => {
    expect(matchesKeyword("anything", null).pass).toBe(true);
    expect(matchesKeyword("anything", "").pass).toBe(true);
  });

  it("matches case-insensitively for contains", () => {
    expect(matchesKeyword("All Systems OK", "systems ok").pass).toBe(true);
    expect(matchesKeyword("All Systems OK", "degraded").pass).toBe(false);
  });

  it("inverts the check for absent mode", () => {
    expect(matchesKeyword("hello world", "error", "absent").pass).toBe(true);
    const bad = matchesKeyword("Application Error", "error", "absent");
    expect(bad.pass).toBe(false);
    expect(bad.error).toContain("forbidden");
  });

  it("supports regex mode", () => {
    expect(matchesKeyword('{"status":"ok"}', '"status"\\s*:\\s*"ok"', "regex").pass).toBe(true);
    expect(matchesKeyword('{"status":"bad"}', '"status"\\s*:\\s*"ok"', "regex").pass).toBe(false);
  });

  // A bad pattern is a config bug, and must not be reported as an outage of the
  // target with a mysterious cause.
  it("reports an invalid regex as a configuration error", () => {
    const r = matchesKeyword("body", "([unclosed", "regex");
    expect(r.pass).toBe(false);
    expect(r.error).toContain("Invalid keyword regex");
  });
});

describe("parseHostPort", () => {
  it("applies the default port when none is given", () => {
    expect(parseHostPort("example.com", 443)).toEqual({
      host: "example.com",
      port: 443,
    });
  });

  it("reads an explicit port", () => {
    expect(parseHostPort("db.internal:5432", 443)).toEqual({
      host: "db.internal",
      port: 5432,
    });
  });

  it("strips a scheme and path", () => {
    expect(parseHostPort("https://example.com:8443/health", 443)).toEqual({
      host: "example.com",
      port: 8443,
    });
  });

  it("treats a bare IPv6 literal as host-only", () => {
    expect(parseHostPort("::1", 6379)).toEqual({ host: "::1", port: 6379 });
  });

  it("reads a port from a bracketed IPv6 literal", () => {
    expect(parseHostPort("[2001:db8::1]:5432", 443)).toEqual({
      host: "2001:db8::1",
      port: 5432,
    });
    expect(parseHostPort("[::1]", 5432)).toEqual({ host: "::1", port: 5432 });
  });

  it("falls back to the default for an out-of-range port", () => {
    expect(parseHostPort("example.com:99999", 443).port).toBe(443);
    expect(parseHostPort("example.com:abc", 443).port).toBe(443);
  });
});

describe("applyDegraded", () => {
  it("is up when no threshold is set", () => {
    expect(applyDegraded(9999, null)).toBe("up");
    expect(applyDegraded(9999, undefined)).toBe("up");
  });

  it("degrades strictly above the threshold", () => {
    expect(applyDegraded(500, 500)).toBe("up");
    expect(applyDegraded(501, 500)).toBe("degraded");
  });

  it("is up when latency is unknown", () => {
    expect(applyDegraded(null, 500)).toBe("up");
  });
});
