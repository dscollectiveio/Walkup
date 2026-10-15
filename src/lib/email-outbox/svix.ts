import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Svix-signed webhook (Resend uses Svix), money spec 5.3. The
 * signature covers `${id}.${timestamp}.${rawBody}` with HMAC-SHA256 and the
 * base64 key after "whsec_". Accepts any `v1,<sig>` in the space-separated
 * header; compares in constant time; refuses a timestamp more than five
 * minutes from now in either direction.
 */
export const SVIX_TOLERANCE_SECONDS = 300;

export function verifySvix(opts: {
  secret: string | undefined;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
}): boolean {
  const { secret, id, timestamp, signature, body } = opts;
  if (!secret || !id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  let match = false;
  for (const entry of signature.split(" ")) {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) match = true;
  }
  return match;
}
