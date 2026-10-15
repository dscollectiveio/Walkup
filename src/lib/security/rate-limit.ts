/**
 * A small fixed-window limiter held in this server instance's memory.
 *
 * It is a brake, not a quota: on serverless each instance counts for itself, so
 * the real ceiling is the limit times the number of warm instances. That is
 * enough to stop one signed-in account looping a paid lookup from a script
 * (REVIEW-2 #12); anything that must be exact belongs in the database.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

export function takeToken(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear();
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (b.count >= limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  b.count += 1;
  return { ok: true };
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}
