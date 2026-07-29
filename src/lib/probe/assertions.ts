/**
 * Assertion helpers. Pure and side-effect free so the interesting edge cases are
 * unit-testable without opening a socket.
 */

/**
 * Does an HTTP status satisfy the monitor's expectation?
 *
 * The spec is a comma-separated list mixing three notations, because different
 * people reach for different ones and there is no reason to force a choice:
 *   exact     "200", "200,201,204"
 *   wildcard  "2xx", "30x"
 *   range     "200-299"
 *
 * An empty or unparseable spec falls back to 2xx, which is the safe default: it
 * fails closed on a 500 rather than silently accepting everything.
 */
export function matchesExpectedStatus(spec: string, code: number): boolean {
  const parts = (spec || "2xx")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) return code >= 200 && code < 300;

  return parts.some((part) => {
    // range: 200-299
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(part);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      return code >= Math.min(lo, hi) && code <= Math.max(lo, hi);
    }

    // wildcard: 2xx, 30x, 4x x
    if (part.includes("x")) {
      if (part.length !== 3) return false;
      for (let i = 0; i < 3; i++) {
        const c = part[i]!;
        if (c === "x") continue;
        if (!/\d/.test(c)) return false;
        if (String(code).padStart(3, "0")[i] !== c) return false;
      }
      return true;
    }

    // exact
    return /^\d{1,3}$/.test(part) && Number(part) === code;
  });
}

export type KeywordMode = "contains" | "absent" | "regex";

export interface KeywordOutcome {
  pass: boolean;
  /** Populated only on failure, ready to show to a human. */
  error?: string;
}

/**
 * Evaluate a body assertion.
 *
 * `absent` exists because the most useful signal is often a *negative* one: a
 * broken deploy usually still returns 200, but with "Application Error" in the
 * body. Matching on the status alone would call that healthy.
 */
export function matchesKeyword(
  body: string,
  keyword: string | null | undefined,
  mode: KeywordMode = "contains",
): KeywordOutcome {
  if (!keyword) return { pass: true };

  if (mode === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(keyword, "i");
    } catch {
      // A malformed pattern is a configuration bug, not an outage. Say so
      // plainly instead of reporting the target as down for a mystery reason.
      return { pass: false, error: `Invalid keyword regex: ${keyword}` };
    }
    return re.test(body)
      ? { pass: true }
      : { pass: false, error: `Body did not match /${keyword}/i` };
  }

  const found = body.toLowerCase().includes(keyword.toLowerCase());

  if (mode === "absent") {
    return found
      ? { pass: false, error: `Body contained forbidden text "${keyword}"` }
      : { pass: true };
  }

  return found
    ? { pass: true }
    : { pass: false, error: `Body did not contain "${keyword}"` };
}

/**
 * Split "host:port" into parts, applying a default port.
 * Handles bracketed IPv6 literals — `[::1]:5432`.
 */
export function parseHostPort(
  target: string,
  defaultPort: number,
): { host: string; port: number } {
  const raw = target.trim().replace(/^\w+:\/\//, "");

  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(raw);
  if (v6) {
    return { host: v6[1]!, port: v6[2] ? Number(v6[2]) : defaultPort };
  }

  const idx = raw.lastIndexOf(":");
  // A bare IPv6 address has several colons and no port.
  if (idx === -1 || raw.indexOf(":") !== idx) {
    return { host: raw.split("/")[0]!, port: defaultPort };
  }

  const host = raw.slice(0, idx);
  const port = Number(raw.slice(idx + 1).split("/")[0]);
  return {
    host,
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : defaultPort,
  };
}

/**
 * Latency verdict. A monitor that answers correctly but takes eight seconds is
 * not "up" in any sense a user would recognise, so slow responses degrade rather
 * than pass silently.
 */
export function applyDegraded(
  latencyMs: number | null,
  degradedMs: number | null | undefined,
): "up" | "degraded" {
  if (!degradedMs || latencyMs === null) return "up";
  return latencyMs > degradedMs ? "degraded" : "up";
}
