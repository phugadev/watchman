import net from "node:net";
import { performance } from "node:perf_hooks";
import { applyDegraded, parseHostPort } from "./assertions";
import {
  type ProbeResult,
  type ProbeSpec,
  describeError,
  truncateError,
} from "./types";

/**
 * TCP connect probe: can we complete a handshake to host:port?
 *
 * The right check for anything that speaks a protocol Watchman does not — a
 * Postgres port, a Redis instance, an SMTP relay, a game server. It answers the
 * only question that generalises: is something listening and accepting?
 */
export async function probeTcp(spec: ProbeSpec): Promise<ProbeResult> {
  const { host, port } = parseHostPort(spec.target, 80);

  if (!host) {
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: `Invalid target: ${spec.target}`,
    };
  }

  const timeoutMs = spec.timeoutMs ?? 10_000;
  const start = performance.now();

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let dnsMs: number | undefined;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    socket.once("lookup", () => {
      dnsMs = performance.now() - start;
    });

    socket.once("connect", () => {
      const latencyMs = Math.round(performance.now() - start);
      finish({
        ok: true,
        status: applyDegraded(latencyMs, spec.degradedMs),
        latencyMs,
        error: null,
        meta: {
          host,
          port,
          ip: socket.remoteAddress,
          timings: {
            dnsMs: dnsMs === undefined ? undefined : Math.round(dnsMs),
            connectMs: latencyMs,
            totalMs: latencyMs,
          },
        },
      });
    });

    socket.once("timeout", () => {
      finish({
        ok: false,
        status: "down",
        latencyMs: null,
        error: `Connection to ${host}:${port} timed out after ${timeoutMs}ms`,
        meta: { host, port },
      });
    });

    socket.once("error", (err) => {
      finish({
        ok: false,
        status: "down",
        latencyMs: null,
        error: truncateError(describeError(err)),
        meta: { host, port },
      });
    });
  });
}
