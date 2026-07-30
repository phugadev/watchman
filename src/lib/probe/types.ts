import type { MonitorKind } from "@/lib/db/schema";

export type CheckStatus = "up" | "degraded" | "down";

/**
 * The timing breakdown of a request, in milliseconds from request start.
 *
 * Recording the phases separately — rather than one total — is what lets an
 * operator tell "your DNS provider is slow" apart from "your app is slow", which
 * are the same number on a single-value chart.
 */
export interface PhaseTimings {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  ttfbMs?: number;
  transferMs?: number;
  totalMs: number;
}

export interface ProbeResult {
  /** Did the check pass its assertions? Degraded still counts as ok. */
  ok: boolean;
  status: CheckStatus;
  /** Total round trip. Null when the probe never got far enough to measure. */
  latencyMs: number | null;
  httpStatus?: number | null;
  /** Short, human-readable failure reason. Rendered verbatim in the UI. */
  error?: string | null;
  timings?: PhaseTimings;
  /** Probe-specific detail, persisted as JSON on the check row. */
  meta?: Record<string, unknown>;
}

/** The subset of a monitor a probe needs. Keeps probes free of DB coupling. */
export interface ProbeSpec {
  kind: MonitorKind;
  target: string;
  method?: string;
  headers?: Record<string, string> | null;
  body?: string | null;
  expectedStatus?: string;
  keyword?: string | null;
  keywordMode?: "contains" | "absent" | "regex";
  followRedirects?: boolean;
  verifyTls?: boolean;
  timeoutMs?: number;
  degradedMs?: number | null;
  sslWarnDays?: number;
}

export const MAX_REDIRECTS = 5;

/**
 * Response bodies are read only up to this size, and only when a keyword
 * assertion needs them. A monitored endpoint that starts streaming gigabytes
 * should not take the monitor down with it.
 */
export const MAX_BODY_BYTES = 512 * 1024;

/** Normalise anything thrown by the network stack into one short line. */
export function describeError(err: unknown): string {
  if (err === null || err === undefined) return "unknown error";
  const e = err as NodeJS.ErrnoException & { reason?: string };

  // Node error codes are far more useful to an operator than the messages that
  // accompany them, so translate the common ones into plain language.
  const byCode: Record<string, string> = {
    ENOTFOUND: "DNS lookup failed — host not found",
    EAI_AGAIN: "DNS lookup timed out",
    ECONNREFUSED: "Connection refused",
    ECONNRESET: "Connection reset by peer",
    ETIMEDOUT: "Connection timed out",
    EHOSTUNREACH: "Host unreachable",
    ENETUNREACH: "Network unreachable",
    EPIPE: "Connection closed unexpectedly",
    EPROTO: "Protocol error during handshake",
    CERT_HAS_EXPIRED: "TLS certificate has expired",
    DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is self-signed",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate chain is incomplete",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match hostname",
    SELF_SIGNED_CERT_IN_CHAIN: "Self-signed certificate in chain",
  };

  if (e.code && byCode[e.code]) return byCode[e.code]!;

  // TLS verification failures arrive as `socket.authorizationError`, where the
  // OpenSSL code is the *message* and `code` is unset — so the same lookup has to
  // be tried against the message before falling through to raw text.
  if (e.message && byCode[e.message]) return byCode[e.message]!;

  if (e.code) return `${e.code}${e.message ? `: ${e.message}` : ""}`;
  if (e instanceof Error) return e.message || e.name;
  // `err` is unknown here, so String() could yield "[object Object]". Prefer the JSON
  // shape, which at least names the fields, and fall back only if it is not encodable.
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return "unserialisable error";
  }
}

/**
 * Certificate distinguished-name fields are `string | string[]` — a cert may
 * legitimately carry several CN or O entries. Take the first for display.
 */
export function firstDn(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Clamp long upstream errors so they stay renderable in a table cell. */
export function truncateError(msg: string, max = 300): string {
  const flat = msg.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
