import type { Monitor } from "@/lib/db/schema";
import { probeDns } from "./dns";
import { probeHttp } from "./http";
import { probePing } from "./ping";
import { probeSsl } from "./ssl";
import { probeTcp } from "./tcp";
import { evaluateHeartbeat } from "./heartbeat";
import type { ProbeResult, ProbeSpec } from "./types";

export * from "./types";
export * from "./assertions";
export * from "./dns";
export { probeHttp, probePing, probeSsl, probeTcp, probeDns, evaluateHeartbeat };

/** Build the probe input from a stored monitor row. */
export function specFromMonitor(m: Monitor): ProbeSpec {
  let headers: Record<string, string> | null = null;
  if (m.headers) {
    try {
      const parsed = JSON.parse(m.headers);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        headers = parsed as Record<string, string>;
      }
    } catch {
      // A malformed header blob should not take the check down; the form
      // validates this on write, so reaching here means hand-edited data.
      headers = null;
    }
  }

  return {
    kind: m.kind,
    target: m.target,
    method: m.method,
    headers,
    body: m.body,
    expectedStatus: m.expectedStatus,
    keyword: m.keyword,
    keywordMode: m.keywordMode,
    followRedirects: m.followRedirects,
    verifyTls: m.verifyTls,
    timeoutMs: m.timeoutMs,
    degradedMs: m.degradedMs,
    sslWarnDays: m.sslWarnDays,
    dnsRecordType: m.dnsRecordType,
    dnsExpected: m.dnsExpected,
    dnsMatchMode: m.dnsMatchMode,
    dnsResolver: m.dnsResolver,
  };
}

/**
 * Run the probe matching a monitor's kind.
 *
 * Heartbeats are handled by the caller (the scheduler), which owns the last-ping
 * timestamp; routing one here is a programming error rather than a runtime
 * condition, so it returns a loud result instead of throwing into the tick loop.
 */
export async function runProbe(spec: ProbeSpec): Promise<ProbeResult> {
  switch (spec.kind) {
    case "http":
      return probeHttp(spec);
    case "tcp":
      return probeTcp(spec);
    case "ping":
      return probePing(spec);
    case "ssl":
      return probeSsl(spec);
    case "dns":
      return probeDns(spec);
    case "heartbeat":
      return {
        ok: false,
        status: "down",
        latencyMs: null,
        error: "Heartbeat monitors are evaluated by the scheduler, not probed",
      };
    default: {
      const exhaustive: never = spec.kind;
      return {
        ok: false,
        status: "down",
        latencyMs: null,
        error: `Unknown monitor kind: ${String(exhaustive)}`,
      };
    }
  }
}

/** Human label per kind, used in the UI and in alert payloads. */
export const KIND_LABEL: Record<Monitor["kind"], string> = {
  http: "HTTP",
  tcp: "TCP",
  ping: "Ping",
  ssl: "TLS cert",
  dns: "DNS",
  heartbeat: "Heartbeat",
};

export const KIND_HINT: Record<Monitor["kind"], string> = {
  http: "Request a URL and assert on status code, body, and response time.",
  tcp: "Open a TCP connection to host:port. For anything that isn't HTTP.",
  ping: "ICMP echo. Reachability only — no application-level guarantee.",
  ssl: "Watch a certificate's expiry and trust chain before it bites.",
  dns: "Resolve a name and assert on the answer. Catches a zone breaking or being changed under you.",
  heartbeat: "A dead man's switch: alert when a job stops checking in.",
};
