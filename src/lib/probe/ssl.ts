import tls from "node:tls";
import { performance } from "node:perf_hooks";
import { parseHostPort } from "./assertions";
import {
  type ProbeResult,
  type ProbeSpec,
  describeError,
  firstDn,
  truncateError,
} from "./types";

/**
 * TLS certificate probe.
 *
 * Expired certificates are among the most common self-inflicted outages, and the
 * failure is unusual in that it is perfectly predictable weeks ahead. This probe
 * exists to turn that into a warning rather than an incident: the monitor goes
 * degraded once expiry falls inside the warning window, and only fails outright
 * when the certificate is actually invalid.
 */
export async function probeSsl(spec: ProbeSpec): Promise<ProbeResult> {
  const { host, port } = parseHostPort(spec.target, 443);

  if (!host) {
    return {
      ok: false,
      status: "down",
      latencyMs: null,
      error: `Invalid target: ${spec.target}`,
    };
  }

  const timeoutMs = spec.timeoutMs ?? 10_000;
  const warnDays = spec.sslWarnDays ?? 21;
  const start = performance.now();

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = tls.connect({
      host,
      port,
      servername: host, // SNI — without it, shared hosts return the wrong cert.
      // Verification failures are reported as findings rather than thrown, so a
      // self-signed or hostname-mismatched certificate produces a useful message
      // instead of an opaque handshake error.
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });

    socket.once("secureConnect", () => {
      const latencyMs = Math.round(performance.now() - start);
      const cert = socket.getPeerCertificate();

      if (!cert || Object.keys(cert).length === 0) {
        return finish({
          ok: false,
          status: "down",
          latencyMs,
          error: "Peer presented no certificate",
          meta: { host, port },
        });
      }

      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);
      const now = Date.now();
      const daysRemaining = Math.floor((validTo.getTime() - now) / 86_400_000);

      const meta = {
        host,
        port,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.name,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError
          ? String(socket.authorizationError)
          : undefined,
        subject: firstDn(cert.subject?.CN),
        issuer: firstDn(cert.issuer?.CN) ?? firstDn(cert.issuer?.O),
        altNames: cert.subjectaltname,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        daysRemaining,
        fingerprint: cert.fingerprint256,
        timings: { tlsMs: latencyMs, totalMs: latencyMs },
      };

      if (validTo.getTime() <= now) {
        return finish({
          ok: false,
          status: "down",
          latencyMs,
          error: `Certificate expired ${Math.abs(daysRemaining)}d ago`,
          meta,
        });
      }

      if (validFrom.getTime() > now) {
        return finish({
          ok: false,
          status: "down",
          latencyMs,
          error: `Certificate is not valid until ${validFrom.toISOString().slice(0, 10)}`,
          meta,
        });
      }

      // Trust-chain and hostname problems mean real browsers will refuse the
      // connection, so this is a hard failure even though the socket opened.
      if (spec.verifyTls !== false && !socket.authorized) {
        return finish({
          ok: false,
          status: "down",
          latencyMs,
          error: truncateError(
            describeError(socket.authorizationError) ||
              "Certificate failed verification",
          ),
          meta,
        });
      }

      if (daysRemaining <= warnDays) {
        return finish({
          ok: true,
          status: "degraded",
          latencyMs,
          error: `Certificate expires in ${daysRemaining}d`,
          meta,
        });
      }

      finish({
        ok: true,
        status: "up",
        latencyMs,
        error: null,
        meta,
      });
    });

    socket.once("timeout", () => {
      finish({
        ok: false,
        status: "down",
        latencyMs: null,
        error: `TLS handshake with ${host}:${port} timed out after ${timeoutMs}ms`,
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
