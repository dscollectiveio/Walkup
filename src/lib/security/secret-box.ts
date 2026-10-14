import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Seals a secret (today: Plaid access tokens) with AES-256-GCM before it goes
 * into the database, so a stolen database copy, a leaked backup, or a
 * signed-in session calling get_bank_access_token() directly gets ciphertext
 * that is useless without BANK_TOKEN_KEY — a key that lives only in the
 * server's environment, never in the database.
 *
 * Stored form:  enc:v1:<iv>:<auth tag>:<ciphertext>   (all base64url)
 *
 * Rollout is graceful on purpose. With no key configured, secrets pass
 * through as plain text (and a warning is logged), so deploying this can't
 * break bank connections; setting the key switches sealing on, and tokens
 * stored before that are sealed the next time they're used (see
 * lib/plaid/token.ts). Generate a key with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

const PREFIX = "enc:v1:";
let warned = false;

function key(): Buffer | null {
  const raw = process.env.BANK_TOKEN_KEY?.trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("BANK_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return buf;
}

export const isSealed = (stored: string) => stored.startsWith(PREFIX);

/** True when a key is configured, so new secrets will actually be sealed. */
export const sealingEnabled = () => key() !== null;

export function sealSecret(plain: string): string {
  const k = key();
  if (!k) {
    if (!warned) {
      warned = true;
      console.warn("BANK_TOKEN_KEY is not set: bank access tokens are being stored unsealed.");
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/** Plain text in (legacy, or sealing off) comes straight back out; sealed text is opened and verified. */
export function openSecret(stored: string): string {
  if (!isSealed(stored)) return stored;
  const k = key();
  if (!k) throw new Error("This secret is sealed but BANK_TOKEN_KEY is not set.");
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(":");
  if (!iv || !tag || !ct) throw new Error("Malformed sealed secret.");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
