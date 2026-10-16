import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Stripe webhook signature without the stripe package, the same
 * way src/lib/email-outbox/svix.ts verifies Resend's. Stripe sends
 * `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]`; the signature is
 * HMAC-SHA256 over `${t}.${rawBody}` keyed with the endpoint secret string
 * ("whsec_...", used as is). Accepts any matching v1 entry, compares in
 * constant time, and refuses a timestamp more than five minutes from now in
 * either direction (replays).
 */
export const STRIPE_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(opts: {
  secret: string | undefined;
  header: string | null;
  body: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const { secret, header, body } = opts;
  if (!secret || !header) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;

  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > (opts.toleranceSeconds ?? STRIPE_TOLERANCE_SECONDS)) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest();
  let match = false;
  for (const sig of signatures) {
    const candidate = Buffer.from(sig, "hex");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) match = true;
  }
  return match;
}

/** Builds a valid header, for tests and local tooling only. */
export function signStripePayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}
