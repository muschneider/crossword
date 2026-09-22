import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt from `node:crypto`.
 *
 * scrypt is memory-hard, ships with Node and needs no native module, so it
 * deploys to Vercel's free tier with zero extra dependencies (unlike bcrypt or
 * argon2, which require prebuilt binaries).
 *
 * Stored format: `scrypt$N$r$p$<salt base64url>$<hash base64url>`
 * Keeping the parameters inline means they can be raised later without
 * invalidating existing hashes.
 */

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 16384; // 2^14 → ~16 MB of memory per hash
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/** NFKC so visually identical passwords typed on different keyboards match. */
function prepare(password: string): string {
  return password.normalize("NFKC");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(prepare(password), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }

  let derived: Buffer;
  try {
    derived = await scryptAsync(prepare(password), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Burns a comparable amount of CPU when the account does not exist, so response
 * time cannot be used to enumerate registered e-mails.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await scryptAsync("dummy-password", randomBytes(16), KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
}

export type PasswordIssue = string | null;

export function validatePasswordStrength(password: string): PasswordIssue {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return "A senha é longa demais.";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "A senha precisa misturar letras e números.";
  }
  return null;
}
