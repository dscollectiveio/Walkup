/**
 * Session timing rules (docs/SECURITY_POLICY.md section 4d). Pure, so the proxy
 * and the tests share one definition.
 */

/** Signed out after this long with no request. */
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** The activity cookie is rewritten at most this often. */
export const ACTIVITY_REFRESH_MS = 60 * 1000;
/** Role changes need a sign-in (a two-step code) this recent. */
export const FRESH_SIGNIN_MS = 15 * 60 * 1000;

export const ACTIVITY_COOKIE = "walkup.activity";

export type IdleDecision =
  | { action: "expire" }
  | { action: "stamp" } // write the cookie now
  | { action: "keep" }; // recent enough, leave the cookie alone

/** The cookie holds epoch milliseconds. Anything else counts as no cookie. */
export function parseActivity(raw: string | undefined | null, now: number): number | null {
  if (!raw || !/^\d{10,15}$/.test(raw)) return null;
  const n = Number(raw);
  // A time in the future is not something we wrote.
  return n > now + ACTIVITY_REFRESH_MS ? null : n;
}

/**
 * No cookie means a session that began before this shipped, or just began:
 * stamp it rather than sign the person out.
 */
export function idleDecision(lastActivityMs: number | null, now: number): IdleDecision {
  if (lastActivityMs === null) return { action: "stamp" };
  if (now - lastActivityMs >= IDLE_TIMEOUT_MS) return { action: "expire" };
  if (now - lastActivityMs >= ACTIVITY_REFRESH_MS) return { action: "stamp" };
  return { action: "keep" };
}

export interface AmrEntry {
  method?: string;
  timestamp?: number; // seconds
}

/** Seconds timestamp of the latest two-step code in this session's amr claim, or null. */
export function lastTotpAt(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let best: number | null = null;
  for (const e of amr as AmrEntry[]) {
    if (e && e.method === "totp" && typeof e.timestamp === "number" && (best === null || e.timestamp > best)) {
      best = e.timestamp;
    }
  }
  return best;
}

/** True when a two-step code was entered within FRESH_SIGNIN_MS. */
export function isFreshSignIn(amr: unknown, nowMs: number): boolean {
  const at = lastTotpAt(amr);
  return at !== null && nowMs - at * 1000 <= FRESH_SIGNIN_MS && at * 1000 <= nowMs + 60_000;
}

export const FRESH_SIGNIN_MESSAGE =
  "For safety, confirm your sign-in before changing who has access. Open /confirm-sign-in, enter a code from your authenticator app, then try again.";
