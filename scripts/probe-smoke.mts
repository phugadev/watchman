/**
 * Manual probe smoke check — hits real endpoints, so it is not part of `pnpm test`.
 * Run with: npx tsx scripts/probe-smoke.mts
 */
import { probeHttp } from "../src/lib/probe/http.ts";
import { probeTcp } from "../src/lib/probe/tcp.ts";
import { probeSsl } from "../src/lib/probe/ssl.ts";
import { probePing } from "../src/lib/probe/ping.ts";
import { probeDns } from "../src/lib/probe/dns.ts";
import { evaluateHeartbeat } from "../src/lib/probe/heartbeat.ts";
import type { ProbeResult } from "../src/lib/probe/types.ts";

const show = (n: string, r: ProbeResult) =>
  console.log(
    n.padEnd(24),
    r.status.toUpperCase().padEnd(9),
    String(r.latencyMs ?? "-").padStart(8),
    (r.error ?? "").slice(0, 58).padEnd(59),
    r.meta?.timings ? JSON.stringify(r.meta.timings) : "",
  );

show("http example.com", await probeHttp({ kind: "http", target: "https://example.com", expectedStatus: "2xx" }));
show("http 404 vs 2xx", await probeHttp({ kind: "http", target: "https://example.com/nope", expectedStatus: "2xx" }));
show("http 404 vs 404", await probeHttp({ kind: "http", target: "https://example.com/nope", expectedStatus: "404" }));
show("http keyword hit", await probeHttp({ kind: "http", target: "https://example.com", keyword: "Example Domain" }));
show("http keyword miss", await probeHttp({ kind: "http", target: "https://example.com", keyword: "zzz-absent" }));
show("http degraded 1ms", await probeHttp({ kind: "http", target: "https://example.com", degradedMs: 1 }));
show("http bad dns", await probeHttp({ kind: "http", target: "https://nope-abc123.invalid", timeoutMs: 5000 }));
show("http timeout 1ms", await probeHttp({ kind: "http", target: "https://example.com", timeoutMs: 1 }));
show("http expired cert", await probeHttp({ kind: "http", target: "https://expired.badssl.com", timeoutMs: 9000 }));
show("http redirects", await probeHttp({ kind: "http", target: "http://github.com", timeoutMs: 9000 }));
show("tcp example:443", await probeTcp({ kind: "tcp", target: "example.com:443" }));
show("tcp refused :9", await probeTcp({ kind: "tcp", target: "127.0.0.1:9", timeoutMs: 3000 }));
show("ssl example.com", await probeSsl({ kind: "ssl", target: "example.com" }));
show("ssl expired", await probeSsl({ kind: "ssl", target: "expired.badssl.com", timeoutMs: 9000 }));
show("ssl self-signed", await probeSsl({ kind: "ssl", target: "self-signed.badssl.com", timeoutMs: 9000 }));
show("ssl warn 3650d", await probeSsl({ kind: "ssl", target: "example.com", sslWarnDays: 3650 }));
show("dns A", await probeDns({ kind: "dns", target: "example.com", dnsRecordType: "A" }));
show("dns A expect hit", await probeDns({ kind: "dns", target: "one.one.one.one", dnsRecordType: "A", dnsExpected: "1.1.1.1" }));
show("dns A expect miss", await probeDns({ kind: "dns", target: "example.com", dnsRecordType: "A", dnsExpected: "10.0.0.1" }));
show("dns exact extra rec", await probeDns({ kind: "dns", target: "one.one.one.one", dnsRecordType: "A", dnsExpected: "1.1.1.1", dnsMatchMode: "exact" }));
show("dns MX", await probeDns({ kind: "dns", target: "gmail.com", dnsRecordType: "MX" }));
show("dns TXT chunked", await probeDns({ kind: "dns", target: "google.com", dnsRecordType: "TXT" }));
show("dns CAA", await probeDns({ kind: "dns", target: "google.com", dnsRecordType: "CAA" }));
show("dns SOA", await probeDns({ kind: "dns", target: "example.com", dnsRecordType: "SOA" }));
show("dns nxdomain", await probeDns({ kind: "dns", target: "nope-abc123.invalid", dnsRecordType: "A" }));
show("dns no such rrtype", await probeDns({ kind: "dns", target: "example.com", dnsRecordType: "SRV" }));
show("dns via 1.1.1.1", await probeDns({ kind: "dns", target: "example.com", dnsRecordType: "A", dnsResolver: "1.1.1.1" }));
show("dns dead resolver", await probeDns({ kind: "dns", target: "example.com", dnsRecordType: "A", dnsResolver: "192.0.2.1", timeoutMs: 3000 }));
show("ping 1.1.1.1", await probePing({ kind: "ping", target: "1.1.1.1", timeoutMs: 4000 }));
show("ping bad host", await probePing({ kind: "ping", target: "nope-abc123.invalid", timeoutMs: 4000 }));

const now = new Date("2026-01-01T12:00:00Z");
const hb = (ms: number | null, created = now) =>
  evaluateHeartbeat({
    lastPingAt: ms === null ? null : new Date(now.getTime() - ms),
    intervalSec: 300,
    graceSec: 60,
    createdAt: created,
    now,
  });
show("hb fresh", hb(30_000));
show("hb late in grace", hb(330_000));
show("hb dead", hb(900_000));
show("hb never pinged", hb(null, new Date(now.getTime() - 900_000)));
