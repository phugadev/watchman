import { performance } from "node:perf_hooks";
import nodemailer from "nodemailer";
import { renderEmailHtml, renderSubject, renderText } from "./render";
import {
  DELIVERY_TIMEOUT_MS,
  type AlertPayload,
  type DeliveryResult,
  type EmailConfig,
} from "./types";

/**
 * SMTP delivery.
 *
 * A transport is built per send rather than pooled. Pooling would keep sockets
 * open to a server that is idle for days between alerts, and the config lives in
 * the database where it can change under us — reconnecting costs a few hundred
 * milliseconds on a path that runs a handful of times a week.
 */
export async function deliverEmail(
  config: EmailConfig,
  payload: AlertPayload,
): Promise<DeliveryResult> {
  const started = performance.now();

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Implicit TLS on 465; anything else starts plaintext and upgrades. Left
    // undefined, nodemailer infers it from the port, which is right often enough
    // to be a trap on the port where it is wrong.
    secure: config.secure ?? config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
    connectionTimeout: DELIVERY_TIMEOUT_MS,
    greetingTimeout: DELIVERY_TIMEOUT_MS,
    socketTimeout: DELIVERY_TIMEOUT_MS,
  });

  try {
    const info = await transport.sendMail({
      from: config.from,
      to: config.to.join(", "),
      subject: renderSubject(payload),
      // Both parts, always. A text/plain alternative is what a pager gateway or a
      // terminal mail client reads, and it is the part that survives an HTML
      // sanitiser stripping the message to nothing.
      text: renderText(payload),
      html: renderEmailHtml(payload),
    });

    const durationMs = Math.round(performance.now() - started);

    // A server can accept the message for some recipients and reject others. That
    // is a partial failure, and reporting it as success would mean the delivery
    // log says someone was paged when they were not.
    if (info.rejected.length > 0) {
      return {
        ok: false,
        error: `Rejected for ${info.rejected.map(addressText).join(", ")}`,
        durationMs,
        attempts: 1,
        retryable: false,
      };
    }

    return { ok: true, durationMs, attempts: 1 };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    return { ...describeSmtpError(err), durationMs, attempts: 1, ok: false };
  } finally {
    transport.close();
  }
}

/** `rejected` entries are strings or address objects, depending on the input. */
function addressText(a: unknown): string {
  if (typeof a === "string") return a;
  if (a && typeof a === "object" && "address" in a) {
    return typeof a.address === "string" ? a.address : "unknown recipient";
  }
  return "unknown recipient";
}

interface SmtpError extends Error {
  /** The numeric SMTP reply, when the failure came from the server. */
  responseCode?: number;
  /** nodemailer's own classification: ECONNECTION, EAUTH, ETIMEDOUT, EENVELOPE. */
  code?: string;
  response?: string;
}

/**
 * Translate an SMTP failure into a delivery result.
 *
 * Retryability is stated explicitly because SMTP inverts the HTTP convention the
 * generic retry loop assumes: 4xx is the transient class here (greylisting, "try
 * again later", mailbox busy) and 5xx is permanent (no such user, message
 * refused). Retrying a 550 three times just writes the same rejection to the log
 * three times.
 */
function describeSmtpError(err: unknown): {
  error: string;
  statusCode?: number | null;
  retryable: boolean;
} {
  const e = err as SmtpError;

  if (typeof e.responseCode === "number") {
    const transient = e.responseCode >= 400 && e.responseCode < 500;
    // The server's own text is far more useful than the number: "Relay access
    // denied" and "Mailbox full" are both 5xx and want different fixes.
    const detail = (e.response ?? e.message ?? "").replace(/\s+/g, " ").trim();
    return {
      error: `SMTP ${e.responseCode}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      statusCode: e.responseCode,
      retryable: transient,
    };
  }

  const byCode: Record<string, { message: string; retryable: boolean }> = {
    EAUTH: { message: "SMTP authentication failed", retryable: false },
    EENVELOPE: { message: "SMTP rejected the sender or recipient", retryable: false },
    ECONNECTION: { message: "Could not connect to the SMTP server", retryable: true },
    ETIMEDOUT: {
      message: `SMTP timed out after ${DELIVERY_TIMEOUT_MS}ms`,
      retryable: true,
    },
    ESOCKET: { message: "SMTP connection failed — check the TLS setting", retryable: true },
  };

  const known = e.code ? byCode[e.code] : undefined;
  if (known) return { error: known.message, retryable: known.retryable };

  return {
    error: e.message || "Delivery failed",
    // An unrecognised failure is treated as transient. Retrying a permanent error
    // wastes ten seconds; giving up on a transient one loses the alert.
    retryable: true,
  };
}

/** Never render a stored SMTP password, not even partially. */
export function maskSmtpAuth(user: string | undefined): string {
  if (!user) return "none";
  return `${user} · ${"•".repeat(8)}`;
}
