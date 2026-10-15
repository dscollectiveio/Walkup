import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/**
 * Plaid webhook verification, pure so it can be tested without Plaid: the
 * caller supplies `fetchKey` (Plaid's /webhook_verification_key/get, cached).
 * Plaid's procedure: the `Plaid-Verification` header is an ES256 JWT whose
 * payload carries `iat` and the SHA-256 of the exact request body. See
 * docs/security/PLAID-PRODUCTION-REVIEW.md section 4.
 *
 * Nothing in the body is looked at here; the caller parses it only after this
 * returns ok.
 */

export interface PlaidJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid?: string;
  alg?: string;
  use?: string;
  created_at?: number;
  /** Seconds since epoch; null while the key is current. */
  expired_at?: number | null;
}

export type VerifyFailure =
  | "missing_header"
  | "malformed"
  | "bad_alg"
  | "unknown_key"
  | "key_fetch_failed"
  | "expired_key"
  | "bad_signature"
  | "stale"
  | "body_mismatch";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/** Plaid's guidance: reject a webhook whose iat is older than five minutes. */
export const MAX_WEBHOOK_AGE_SECONDS = 300;

const b64urlToBuffer = (s: string) => Buffer.from(s, "base64url");

function parseJson(buf: Buffer): Record<string, unknown> | null {
  try {
    const v = JSON.parse(buf.toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function verifyPlaidWebhook(input: {
  rawBody: string;
  verificationHeader: string | null;
  /** Returns the key for `kid`, null if Plaid does not know it; throws on a transient failure. */
  fetchKey: (kid: string) => Promise<PlaidJwk | null>;
  /** Seconds since epoch; injectable for tests. */
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const fail = (reason: VerifyFailure): VerifyResult => ({ ok: false, reason });
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!input.verificationHeader) return fail("missing_header");
  const parts = input.verificationHeader.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return fail("malformed");
  const [h, p, sig] = parts;

  const header = parseJson(b64urlToBuffer(h));
  if (!header) return fail("malformed");
  // Exactly ES256: never "none", never an HMAC variant a forger could key with a public value.
  if (header.alg !== "ES256") return fail("bad_alg");
  if (typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(header.kid)) return fail("malformed");

  let jwk: PlaidJwk | null;
  try {
    jwk = await input.fetchKey(header.kid);
  } catch {
    return fail("key_fetch_failed");
  }
  if (!jwk) return fail("unknown_key");
  if (jwk.expired_at != null && jwk.expired_at <= now) return fail("expired_key");
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return fail("unknown_key");

  let key;
  try {
    key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
  } catch {
    return fail("unknown_key");
  }

  const signature = b64urlToBuffer(sig);
  if (signature.length !== 64) return fail("bad_signature");
  let valid = false;
  try {
    valid = verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    valid = false;
  }
  if (!valid) return fail("bad_signature");

  const payload = parseJson(b64urlToBuffer(p));
  if (!payload) return fail("malformed");
  const { iat, request_body_sha256: claimed } = payload;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return fail("malformed");
  if (now - iat > MAX_WEBHOOK_AGE_SECONDS) return fail("stale");
  if (iat - now > MAX_WEBHOOK_AGE_SECONDS) return fail("stale"); // from the future: clock games
  if (typeof claimed !== "string" || !/^[0-9a-f]{64}$/i.test(claimed)) return fail("malformed");

  const actual = createHash("sha256").update(input.rawBody, "utf8").digest();
  if (!timingSafeEqual(actual, Buffer.from(claimed, "hex"))) return fail("body_mismatch");

  return { ok: true };
}

/**
 * Caches keys by kid so a burst of webhooks makes one Plaid call, and remembers a kid Plaid did not know for a
 * few minutes: the key is fetched before the signature can be checked, so without that, a flood of forged
 * headers with random kids would spend the app's Plaid credentials and rate limit one call each (REVIEW-2 #13).
 * Calls for one kid share a single request, and no more than `maxConcurrent` run at once.
 */
export function cachedKeyFetcher(
  fetchKey: (kid: string) => Promise<PlaidJwk | null>,
  options: {
    ttlSeconds?: number;
    max?: number;
    missTtlSeconds?: number;
    maxMisses?: number;
    maxConcurrent?: number;
    nowSeconds?: () => number;
  } = {},
) {
  const ttl = options.ttlSeconds ?? 3600;
  const max = options.max ?? 20;
  const missTtl = options.missTtlSeconds ?? 300;
  const maxMisses = options.maxMisses ?? 200;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const clock = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const cache = new Map<string, { key: PlaidJwk; at: number }>();
  const misses = new Map<string, number>();
  const inFlight = new Map<string, Promise<PlaidJwk | null>>();
  return async (kid: string): Promise<PlaidJwk | null> => {
    const now = clock();
    const hit = cache.get(kid);
    if (hit && now - hit.at < ttl) return hit.key;
    const missAt = misses.get(kid);
    if (missAt !== undefined && now - missAt < missTtl) return null;
    const pending = inFlight.get(kid);
    if (pending) return pending;
    if (inFlight.size >= maxConcurrent) throw new Error("too many key lookups in flight");
    const request = (async () => {
      try {
        const key = await fetchKey(kid);
        if (key) {
          if (cache.size >= max) cache.delete(cache.keys().next().value as string);
          cache.set(kid, { key, at: clock() });
        } else {
          if (misses.size >= maxMisses) misses.delete(misses.keys().next().value as string);
          misses.set(kid, clock());
        }
        return key;
      } finally {
        inFlight.delete(kid);
      }
    })();
    inFlight.set(kid, request);
    return request;
  };
}
