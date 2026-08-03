import { Resolver } from "node:dns/promises";
import { performance } from "node:perf_hooks";
import type { DnsRecordType } from "@/lib/db/schema";
import { applyDegraded } from "./assertions";
import {
  type ProbeResult,
  type ProbeSpec,
  describeError,
  truncateError,
} from "./types";

/**
 * How the answer is compared against what you expected.
 *
 * `contains` catches a record disappearing, which is the common failure — a
 * migration that drops an A record, an MX that stops being published. `exact`
 * additionally catches a record *appearing*, which is what you want on a zone
 * where an unexpected answer means someone else is publishing it.
 */
export type DnsMatchMode = "contains" | "exact";

export interface DnsAssertion {
  pass: boolean;
  /** Populated only on failure, ready to show to a human. */
  error?: string;
}

/**
 * Normalise a record for comparison.
 *
 * DNS names are case-insensitive and may or may not carry the root's trailing
 * dot depending on who serialised them, so `Example.COM.` and `example.com` are
 * the same answer and must not read as a failure.
 */
export function normalizeRecord(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}

/**
 * Flatten a resolver answer into comparable strings.
 *
 * Node returns a different shape per record type — strings for A, objects for MX
 * and SRV, arrays of chunks for TXT. Rendering them into one canonical string
 * per record is what lets the expectation be plain text in a form field.
 */
/**
 * Render one field of a record object.
 *
 * The answer is typed `unknown` because it is whatever the resolver handed back,
 * and a bare `String()` on a nested object would silently produce the literal
 * text "[object Object]" inside an expectation someone is comparing against.
 */
function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function formatRecords(type: DnsRecordType, answer: unknown): string[] {
  if (answer === null || answer === undefined) return [];

  // SOA comes back as a single object rather than an array.
  if (type === "SOA") {
    const soa = answer as { nsname?: string; hostmaster?: string; serial?: number };
    if (!soa.nsname) return [];
    return [`${soa.nsname} ${soa.hostmaster ?? ""} ${soa.serial ?? ""}`.trim()];
  }

  if (!Array.isArray(answer)) return [];

  return answer
    .map((record): string => {
      if (typeof record === "string") return record;

      // TXT answers are arrays of chunks that a resolver split at 255 bytes.
      // Joining without a separator reassembles the value the zone published —
      // which matters for the long single strings TXT is mostly used for, like
      // DKIM keys and domain-verification tokens.
      if (Array.isArray(record)) return record.join("");

      if (record && typeof record === "object") {
        const r = record as Record<string, unknown>;
        if (type === "MX") return `${scalar(r.priority)} ${scalar(r.exchange)}`.trim();
        if (type === "SRV") {
          return `${scalar(r.priority)} ${scalar(r.weight)} ${scalar(r.port)} ${scalar(r.name)}`.trim();
        }
        if (type === "CAA") {
          // node returns { critical, type: "CAA", issue: "pki.goog" }. The
          // property tag is whichever key is neither the flag nor the literal
          // record type — taking "the first key after critical" picks up `type`.
          const key = Object.keys(r).find(
            (k) => k !== "critical" && k !== "type",
          );
          return key ? `${key} ${scalar(r[key])}`.trim() : "";
        }
        return JSON.stringify(record);
      }

      return String(record);
    })
    .filter(Boolean);
}

/**
 * Compare an answer against the expectation.
 *
 * An empty expectation is not a failure: plenty of DNS monitors exist only to
 * assert that the name resolves at all, which is already the difference between
 * a working domain and a dead one.
 */
export function evaluateDnsAnswer({
  records,
  expected,
  mode = "contains",
}: {
  records: string[];
  expected: string[];
  mode?: DnsMatchMode;
}): DnsAssertion {
  if (records.length === 0) {
    return { pass: false, error: "No records returned" };
  }

  if (expected.length === 0) return { pass: true };

  const got = new Set(records.map(normalizeRecord));
  const want = expected.map(normalizeRecord).filter(Boolean);

  const missing = want.filter((v) => !got.has(v));

  if (mode === "exact") {
    const wanted = new Set(want);
    const unexpected = [...got].filter((v) => !wanted.has(v));

    if (missing.length === 0 && unexpected.length === 0) return { pass: true };

    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
    if (unexpected.length > 0) parts.push(`unexpected ${unexpected.join(", ")}`);
    return { pass: false, error: `Records do not match exactly — ${parts.join("; ")}` };
  }

  if (missing.length === 0) return { pass: true };

  return {
    pass: false,
    error: `Missing expected record${missing.length === 1 ? "" : "s"}: ${missing.join(", ")} (got ${[...got].join(", ")})`,
  };
}

/** Expectations arrive from a textarea: one per line, or comma-separated. */
export function parseExpectedRecords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * DNS resolution probe.
 *
 * Two distinct failures share one symptom for every other check kind: when a name
 * stops resolving, an HTTP monitor reports "host not found" and leaves you to
 * work out whether the app is down or the zone is. This asks the resolver
 * directly, and can ask a *specific* resolver — pointing one monitor at your
 * authoritative server and another at 1.1.1.1 tells you propagation from
 * publication.
 */
export async function probeDns(spec: ProbeSpec): Promise<ProbeResult> {
  const host = spec.target.trim().replace(/\.$/, "");
  if (!host) {
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: `Invalid target: ${spec.target}`,
    };
  }

  const type = spec.dnsRecordType ?? "A";
  const timeoutMs = spec.timeoutMs ?? 10_000;
  const expected = parseExpectedRecords(spec.dnsExpected);

  // `tries: 1` because the scheduler owns retry policy through confirmFailures.
  // Letting the resolver retry internally would mean a "10s timeout" silently
  // taking thirty, and the recorded latency would describe none of the attempts.
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });

  const server = spec.dnsResolver?.trim();
  if (server) {
    try {
      resolver.setServers([server]);
    } catch {
      return {
        ok: false,
        status: "down",
        latencyMs: null,
        error: `Invalid resolver address: ${server}`,
        meta: { host, type },
      };
    }
  }

  const start = performance.now();

  try {
    const answer = await resolver.resolve(host, type);
    const latencyMs = Math.round(performance.now() - start);
    const records = formatRecords(type, answer);

    const meta = {
      host,
      type,
      records,
      resolver: server ?? "system",
      timings: { dnsMs: latencyMs, totalMs: latencyMs },
    };

    const assertion = evaluateDnsAnswer({
      records,
      expected,
      mode: spec.dnsMatchMode ?? "contains",
    });

    if (!assertion.pass) {
      return {
        ok: false,
        status: "down",
        latencyMs,
        error: assertion.error ?? "DNS assertion failed",
        meta,
      };
    }

    return {
      ok: true,
      status: applyDegraded(latencyMs, spec.degradedMs),
      latencyMs,
      error: null,
      meta,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: truncateError(describeDnsError(err, host, type)),
      meta: { host, type, resolver: server ?? "system", latencyMs },
    };
  }
}

/**
 * DNS failures have their own error codes, and the distinction between them is
 * the whole diagnosis — NXDOMAIN means the name does not exist, NODATA means it
 * does but has no record of that type. A generic "lookup failed" throws that away.
 */
function describeDnsError(err: unknown, host: string, type: DnsRecordType): string {
  const e = err as NodeJS.ErrnoException;

  switch (e.code) {
    case "ENOTFOUND":
    case "ENODATA":
      // Node reports both as ENODATA/ENOTFOUND depending on version and path, so
      // the message covers the pair rather than guessing which one happened.
      return `No ${type} record for ${host}`;
    case "NXDOMAIN":
      return `${host} does not exist (NXDOMAIN)`;
    case "SERVFAIL":
      return `Resolver returned SERVFAIL for ${host} — the authoritative server failed or DNSSEC validation did not pass`;
    case "REFUSED":
      return `Resolver refused the query for ${host}`;
    case "ETIMEOUT":
    case "ETIMEDOUT":
      return `DNS query for ${host} timed out`;
    case "ECONNREFUSED":
      return "Connection to the resolver was refused";
    default:
      return describeError(err);
  }
}
