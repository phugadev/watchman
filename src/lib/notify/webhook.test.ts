import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "./webhook";

const secret = "a-sufficiently-long-test-secret";
const body = JSON.stringify({ event: "monitor.down", monitor: { id: "abc" } });
const now = 1_767_225_600_000; // 2026-01-01T00:00:00Z
const ts = Math.floor(now / 1000);

describe("webhook signing", () => {
  it("is deterministic", () => {
    expect(signWebhook(body, secret, ts)).toBe(signWebhook(body, secret, ts));
  });

  it("accepts a signature it produced", () => {
    expect(
      verifyWebhook({
        body,
        secret,
        timestamp: ts,
        signature: signWebhook(body, secret, ts),
        now,
      }),
    ).toBe(true);
  });

  it("accepts the sha256= prefixed form", () => {
    expect(
      verifyWebhook({
        body,
        secret,
        timestamp: ts,
        signature: `sha256=${signWebhook(body, secret, ts)}`,
        now,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = signWebhook(body, secret, ts);
    expect(
      verifyWebhook({
        body: body.replace("monitor.down", "monitor.up"),
        secret,
        timestamp: ts,
        signature,
        now,
      }),
    ).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(
      verifyWebhook({
        body,
        secret: "some-other-secret-entirely",
        timestamp: ts,
        signature: signWebhook(body, secret, ts),
        now,
      }),
    ).toBe(false);
  });

  // The timestamp is inside the signed string precisely so a captured request
  // cannot be replayed forever.
  it("rejects a stale timestamp outside the tolerance", () => {
    expect(
      verifyWebhook({
        body,
        secret,
        timestamp: ts,
        signature: signWebhook(body, secret, ts),
        now: now + 10 * 60_000,
      }),
    ).toBe(false);
  });

  it("accepts a timestamp inside the tolerance", () => {
    expect(
      verifyWebhook({
        body,
        secret,
        timestamp: ts,
        signature: signWebhook(body, secret, ts),
        now: now + 60_000,
      }),
    ).toBe(true);
  });

  it("rejects a timestamp too far in the future", () => {
    expect(
      verifyWebhook({
        body,
        secret,
        timestamp: ts,
        signature: signWebhook(body, secret, ts),
        now: now - 10 * 60_000,
      }),
    ).toBe(false);
  });

  // A signature swapped for a different timestamp must not validate, or the
  // replay protection would be decorative.
  it("rejects a signature bound to a different timestamp", () => {
    expect(
      verifyWebhook({
        body,
        secret,
        timestamp: ts,
        signature: signWebhook(body, secret, ts - 30),
        now,
      }),
    ).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    for (const signature of ["", "nonsense", "sha256=", "sha256=zz"]) {
      expect(
        verifyWebhook({ body, secret, timestamp: ts, signature, now }),
      ).toBe(false);
    }
  });
});
