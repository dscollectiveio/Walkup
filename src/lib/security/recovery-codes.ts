import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * MFA recovery codes (DECISIONS #46). Ten single-use codes per account, shown
 * once. Only a slow, salted hash is stored (migration 0078); the plaintext
 * exists in memory long enough to show it and is never logged or persisted.
 *
 * A code is 10 characters from a 32-letter alphabet with no look-alikes
 * (50 bits), written XXXXX-XXXXX. The database cannot run scrypt, so the
 * application computes the hash and the database compares and spends it: the
 * stored hashes are never readable by the signed-in user, only their salts
 * (see mfa_recovery_salts / mfa_recovery_redeem).
 */

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_LENGTH = 10;

/** Wrong attempts allowed before the lock, and how long it lasts. Mirrors mfa_recovery_redeem in 0078. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// scrypt cost: about 50 ms per hash. A redeem hashes the typed code against
// each unused salt (at most ten), so one attempt costs roughly half a second.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

export function generateCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let out = "";
  // 256 is a multiple of 32, so the modulo does not bias the choice.
  for (const b of bytes) out += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return out;
}

/** XXXXX-XXXXX, for display and download. */
export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** What a person typed to the stored form: upper case, no spaces or hyphens. Null when it cannot be a code. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== RECOVERY_CODE_LENGTH) return null;
  for (const ch of c) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return c;
}

export function newSalt(): string {
  return randomBytes(SALT_BYTES).toString("base64url");
}

export function hashCode(code: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(code, Buffer.from(salt, "base64url"), KEY_BYTES, SCRYPT, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString("base64url"));
    });
  });
}

/** Constant-time comparison of two stored-form hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "base64url");
  const y = Buffer.from(b, "base64url");
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface RecoveryCodeSet {
  /** Plaintext, formatted. Show once, then drop. */
  codes: string[];
  salts: string[];
  hashes: string[];
}

export async function makeCodeSet(count = RECOVERY_CODE_COUNT): Promise<RecoveryCodeSet> {
  const seen = new Set<string>();
  while (seen.size < count) seen.add(generateCode());
  const raw = [...seen];
  const salts = raw.map(() => newSalt());
  const hashes = await Promise.all(raw.map((c, i) => hashCode(c, salts[i])));
  return { codes: raw.map(formatCode), salts, hashes };
}

/** One digest per unused salt, so the database can look for a match without ever sending a hash out. */
export function digestsFor(code: string, salts: string[]): Promise<string[]> {
  return Promise.all(salts.map((s) => hashCode(code, s)));
}

// ---------------------------------------------------------------------------
// Lockout. The database is the authority (mfa_recovery_redeem); this is the
// same rule in plain code so the numbers are written down once and tested.
// ---------------------------------------------------------------------------

export interface LockState {
  failed: number;
  lockedUntil: number | null;
}

export function isLocked(state: LockState, now: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}

export function minutesLeft(state: LockState, now: number): number {
  return state.lockedUntil === null ? 0 : Math.max(0, Math.ceil((state.lockedUntil - now) / 60_000));
}

/** The state after one attempt. A locked state is returned unchanged; an expired lock starts clean. */
export function afterAttempt(state: LockState, ok: boolean, now: number): LockState {
  if (isLocked(state, now)) return state;
  const base: LockState = state.lockedUntil !== null ? { failed: 0, lockedUntil: null } : state;
  if (ok) return { failed: 0, lockedUntil: null };
  const failed = base.failed + 1;
  return failed >= MAX_FAILED_ATTEMPTS
    ? { failed: 0, lockedUntil: now + LOCK_MINUTES * 60_000 }
    : { failed, lockedUntil: null };
}
