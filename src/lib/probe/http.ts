import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import type { TLSSocket } from "node:tls";
import { env } from "@/lib/env";
import {
  applyDegraded,
  matchesExpectedStatus,
  matchesKeyword,
} from "./assertions";
import {
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  type PhaseTimings,
  type ProbeResult,
  type ProbeSpec,
  describeError,
  firstDn,
  truncateError,
} from "./types";

interface RawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  bodyBytes: number;
  timings: PhaseTimings;
  tls?: {
    protocol: string | null;
    subject?: string;
    issuer?: string;
    validTo?: string;
    daysRemaining?: number;
  };
  remoteAddress?: string;
}

/**
 * One HTTP(S) request with a full phase-timing breakdown.
 *
 * This is deliberately built on node:http rather than fetch. fetch cannot expose
 * DNS/connect/TLS boundaries, cannot disable certificate verification per
 * request, and cannot surface the peer certificate — all three of which Watchman
 * needs. The extra ~60 lines buys a real waterfall instead of a single number.
 */
function requestOnce(
  url: URL,
  spec: ProbeSpec,
  needBody: boolean,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const isTls = url.protocol === "https:";
    const transport = isTls ? https : http;
    const start = performance.now();
    const since = () => performance.now() - start;

    const timings: PhaseTimings = { totalMs: 0 };
    let settled = false;

    const req = transport.request(
      url,
      {
        method: (spec.method ?? "GET").toUpperCase(),
        headers: {
          "user-agent": env.userAgent,
          accept: "*/*",
          // Compression is declined on purpose: keyword assertions run against
          // the body, and decoding gzip here would add a failure mode that has
          // nothing to do with the health of the target.
          "accept-encoding": "identity",
          ...(spec.headers ?? {}),
        },
        // Redirects are followed manually so each hop can be timed and the chain
        // reported.
        timeout: spec.timeoutMs ?? 10_000,
        rejectUnauthorized: spec.verifyTls !== false,
        // Never reuse sockets. A pooled connection would skip the DNS/TCP/TLS
        // phases and report a latency the target's real users never experience.
        agent: false,
      },
      (res) => {
        timings.ttfbMs = since();

        let bytes = 0;
        let truncated = false;
        const chunks: Buffer[] = [];

        // Read the peer certificate off the socket while it is still open —
        // after `end` on a non-keepalive connection it may already be gone.
        const readTls = (): RawResponse["tls"] | undefined => {
          const socket = res.socket as TLSSocket | undefined;
          if (!isTls || typeof socket?.getPeerCertificate !== "function") {
            return undefined;
          }
          const cert = socket.getPeerCertificate();
          if (!cert || Object.keys(cert).length === 0) return undefined;
          const validTo = cert.valid_to ? new Date(cert.valid_to) : undefined;
          return {
            protocol: socket.getProtocol?.() ?? null,
            subject: firstDn(cert.subject?.CN),
            issuer: firstDn(cert.issuer?.CN) ?? firstDn(cert.issuer?.O),
            validTo: validTo?.toISOString(),
            daysRemaining: validTo
              ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
              : undefined,
          };
        };

        const settle = (tls: RawResponse["tls"] | undefined) => {
          if (settled) return;
          settled = true;
          timings.totalMs = since();
          timings.transferMs = timings.totalMs - (timings.ttfbMs ?? 0);
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            bodyBytes: bytes,
            timings,
            tls,
            remoteAddress: res.socket?.remoteAddress ?? undefined,
          });
        };

        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (needBody && !truncated) chunks.push(chunk);
          if (bytes >= MAX_BODY_BYTES) {
            // Stop reading, but settle with what we have rather than waiting for
            // `end` — destroying the stream emits `close`, never `end`, so
            // relying on `end` here would leave the probe hanging until its
            // timeout on any response larger than the cap.
            truncated = true;
            const tls = readTls();
            res.destroy();
            settle(tls);
          }
        });

        res.on("end", () => settle(readTls()));

        // A connection dropped mid-body is a genuine failure, but only if we have
        // not already settled from the size cap.
        res.on("close", () => {
          if (settled) return;
          settled = true;
          reject(
            Object.assign(new Error("Connection closed before response ended"), {
              code: "ECONNRESET",
            }),
          );
        });

        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      },
    );

    req.on("socket", (socket) => {
      socket.once("lookup", () => {
        timings.dnsMs = since();
      });
      socket.once("connect", () => {
        timings.connectMs = since();
      });
      socket.once("secureConnect", () => {
        timings.tlsMs = since();
      });
    });

    req.on("timeout", () => {
      if (settled) return;
      settled = true;
      req.destroy();
      const e = new Error(
        `Timed out after ${spec.timeoutMs ?? 10_000}ms`,
      ) as NodeJS.ErrnoException;
      e.code = "ETIMEDOUT";
      reject(e);
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    if (spec.body && !["GET", "HEAD"].includes((spec.method ?? "GET").toUpperCase())) {
      req.write(spec.body);
    }
    req.end();
  });
}

/**
 * Probe an HTTP endpoint: follow redirects, assert on status and body, and grade
 * the latency.
 */
export async function probeHttp(spec: ProbeSpec): Promise<ProbeResult> {
  let url: URL;
  try {
    url = new URL(spec.target);
  } catch {
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: `Invalid URL: ${spec.target}`,
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: `Unsupported protocol: ${url.protocol}`,
    };
  }

  const needBody = Boolean(spec.keyword);
  const chain: string[] = [];
  // Redirect hops are summed so latency reflects what a user actually waits for.
  let elapsed = 0;
  let hops = 0;
  let current = url;

  try {
    for (;;) {
      const res = await requestOnce(current, spec, needBody);
      elapsed += res.timings.totalMs;

      const isRedirect =
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        typeof res.headers.location === "string";

      if (isRedirect && spec.followRedirects !== false) {
        if (hops >= MAX_REDIRECTS) {
          return {
            ok: false,
            status: "down",
            latencyMs: Math.round(elapsed),
            httpStatus: res.statusCode,
            error: `Exceeded ${MAX_REDIRECTS} redirects`,
            meta: { redirects: chain },
          };
        }
        hops++;
        const next = new URL(res.headers.location!, current);
        chain.push(next.toString());
        current = next;
        continue;
      }

      // Terminal response — run the assertions.
      const latencyMs = Math.round(elapsed);
      const meta: Record<string, unknown> = {
        url: current.toString(),
        bodyBytes: res.bodyBytes,
        hops: hops + 1,
        timings: {
          dnsMs: round(res.timings.dnsMs),
          connectMs: round(res.timings.connectMs),
          tlsMs: round(res.timings.tlsMs),
          ttfbMs: round(res.timings.ttfbMs),
          totalMs: round(res.timings.totalMs),
        },
      };
      if (chain.length) meta.redirects = chain;
      if (res.tls) meta.tls = res.tls;
      if (res.remoteAddress) meta.ip = res.remoteAddress;

      if (!matchesExpectedStatus(spec.expectedStatus ?? "2xx", res.statusCode)) {
        return {
          ok: false,
          status: "down",
          latencyMs,
          httpStatus: res.statusCode,
          error: `Expected ${spec.expectedStatus ?? "2xx"}, got ${res.statusCode}`,
          timings: res.timings,
          meta,
        };
      }

      const kw = matchesKeyword(res.body, spec.keyword, spec.keywordMode);
      if (!kw.pass) {
        return {
          ok: false,
          status: "down",
          latencyMs,
          httpStatus: res.statusCode,
          error: kw.error,
          timings: res.timings,
          meta,
        };
      }

      // A certificate about to expire is a real problem even while the endpoint
      // still answers, so surface it as degraded rather than waiting for the
      // outage.
      const certDays = res.tls?.daysRemaining;
      const warnDays = spec.sslWarnDays ?? 21;
      if (typeof certDays === "number" && certDays <= warnDays) {
        return {
          ok: true,
          status: "degraded",
          latencyMs,
          httpStatus: res.statusCode,
          error: `TLS certificate expires in ${certDays}d`,
          timings: res.timings,
          meta,
        };
      }

      return {
        ok: true,
        status: applyDegraded(latencyMs, spec.degradedMs),
        latencyMs,
        httpStatus: res.statusCode,
        error: null,
        timings: res.timings,
        meta,
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: "down",
      latencyMs: elapsed > 0 ? Math.round(elapsed) : null,
      error: truncateError(describeError(err)),
      meta: chain.length ? { redirects: chain } : undefined,
    };
  }
}

const round = (n: number | undefined) =>
  n === undefined ? undefined : Math.round(n);
