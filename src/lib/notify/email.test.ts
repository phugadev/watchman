import { describe, expect, it } from "vitest";
import { describeSmtpError, maskSmtpAuth } from "./email";

/**
 * The shapes here are copied from what nodemailer actually threw against a live
 * Mailpit container, not from the documentation. The distinction matters: two of
 * these three arrive as the same `code` and want opposite fixes.
 */
function smtpError(over: { message?: string } & Record<string, unknown>) {
  return Object.assign(new Error(over.message ?? ""), over);
}

describe("describeSmtpError", () => {
  it("reports a refused connection as refused, not as a TLS problem", () => {
    const r = describeSmtpError(
      smtpError({
        code: "ESOCKET",
        errno: -61,
        message: "connect ECONNREFUSED 127.0.0.1:1099",
      }),
    );

    expect(r.error).toBe("Connection refused by the SMTP server");
    // The server may simply be restarting.
    expect(r.retryable).toBe(true);
  });

  it("recognises implicit TLS pointed at a plaintext port", () => {
    // Same `code` as the refused case — only the message tells them apart.
    const r = describeSmtpError(
      smtpError({
        code: "ESOCKET",
        message:
          "809EBBEF01000000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number",
      }),
    );

    expect(r.error).toContain("implicit TLS");
    // Encryption settings do not fix themselves; three more attempts are waste.
    expect(r.retryable).toBe(false);
  });

  it("falls back to a neutral message for an unrecognised socket failure", () => {
    const r = describeSmtpError(smtpError({ code: "ESOCKET", message: "something else" }));
    expect(r.error).toBe("Could not open a connection to the SMTP server");
    expect(r.retryable).toBe(true);
  });

  it("treats a 4xx reply as transient — SMTP inverts the HTTP convention", () => {
    const r = describeSmtpError(
      smtpError({ responseCode: 451, response: "4.7.1 Greylisted, try again later" }),
    );

    expect(r.statusCode).toBe(451);
    expect(r.retryable).toBe(true);
    expect(r.error).toContain("Greylisted");
  });

  it("treats a 5xx reply as permanent, and keeps the server's own wording", () => {
    const r = describeSmtpError(
      smtpError({ responseCode: 550, response: "5.7.1 Relay access denied" }),
    );

    expect(r.statusCode).toBe(550);
    expect(r.retryable).toBe(false);
    // "Relay access denied" and "Mailbox full" are both 5xx and want different fixes.
    expect(r.error).toContain("Relay access denied");
  });

  it("does not retry a rejected credential", () => {
    expect(describeSmtpError(smtpError({ code: "EAUTH" })).retryable).toBe(false);
  });

  it("retries an unrecognised failure rather than losing the alert", () => {
    expect(describeSmtpError(smtpError({ message: "who knows" })).retryable).toBe(true);
  });
});

describe("maskSmtpAuth", () => {
  it("never renders the password, and says so when there is no auth at all", () => {
    expect(maskSmtpAuth("postmaster@example.com")).toBe(
      "postmaster@example.com · ••••••••",
    );
    expect(maskSmtpAuth(undefined)).toBe("none");
    expect(maskSmtpAuth("")).toBe("none");
  });
});
