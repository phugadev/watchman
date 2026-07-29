import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";
import { env } from "@/lib/env";

// promisify resolves to scrypt's 3-argument overload, which drops the options
// parameter needed to set N/r/p. Assert the 4-argument signature instead.
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/*
 * Password hashing with scrypt from node:crypto.
 *
 * argon2id would be the textbook choice, but every JS implementation is either a
 * native addon (a second thing to compile in the Docker build, on top of
 * better-sqlite3) or WASM. scrypt is memory-hard, has been in the standard library
 * for years, and at these parameters costs ~100ms per verification — enough to
 * make offline cracking expensive, cheap enough that a login feels instant. Zero
 * added dependencies matters more here than the last increment of hardness.
 */
const KEYLEN = 64;
const SALT_BYTES = 16;
const PARAMS = { N: 32_768, r: 8, p: 1 } as const;
// scrypt needs roughly 128 * N * r bytes; the default 32MB cap is below that.
const MAXMEM = 96 * 1024 * 1024;

/** Stored as `scrypt$N$r$p$saltB64$hashB64` so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    ...PARAMS,
    maxmem: MAXMEM,
  });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Parameters are read from the record rather than assumed, so raising the cost
 * factor does not lock out existing users. Comparison is constant-time.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, "base64");
    const expected = Buffer.from(parts[5]!, "base64");

    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
      return false;
    }

    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAXMEM,
    });

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Hash a bearer token (session cookie, invite token, heartbeat lookup key).
 *
 * Keyed with the instance secret so the digests are not portable: a database
 * lifted from one deployment cannot be probed with a precomputed table, and a
 * token cannot be verified without also holding WATCHMAN_SECRET.
 */
export function hashToken(token: string): string {
  return createHash("sha256")
    .update(`${env.secret}:${token}`)
    .digest("hex");
}

// The policy itself lives in ./policy so client components can import it without
// pulling node:crypto into the browser bundle.
export {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  validatePassword,
} from "./policy";
