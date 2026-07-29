import { randomBytes, randomUUID } from "node:crypto";

/**
 * Crockford base32 — no I, L, O, or U, so ids survive being read aloud, typed
 * from a screenshot, or pasted out of a chat message without transcription
 * errors. Heartbeat tokens in particular end up in cron files people edit by
 * hand.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

/** Short, sortable-enough public identifier. ~12 chars ≈ 60 bits. */
export function newId(length = 12): string {
  return encode(randomBytes(length));
}

/**
 * Heartbeat token. Longer than an id because it is a bearer credential — anyone
 * holding it can mark a job alive — and it travels in URLs.
 */
export function newHeartbeatToken(): string {
  return encode(randomBytes(26)).toLowerCase();
}

/** Session and invite tokens. Full-entropy, never displayed truncated. */
export function newSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newUuid(): string {
  return randomUUID();
}
