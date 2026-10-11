/**
 * A short memory for Plaid balance answers, per server instance. The bank
 * feed page re-renders on every click, keystroke and filter change, and each
 * render used to ask Plaid for the balance again — the slowest and only
 * per-request-billed call on the page. A balance from the last few minutes
 * is the same balance; "Sync now" and Reconnect forget it so a person who
 * asks for fresh numbers gets them. Only good answers are kept: an error or
 * a sign-in-again is re-asked next time.
 *
 * Authorization is not cached: the caller still resolves the access token
 * through the RLS-gated RPC before reading from here.
 */
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; value: unknown }>();

export async function rememberBalance<T extends { error?: string; needsReconnect?: boolean }>(
  connectionId: string,
  fetch: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(connectionId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fetch();
  if (!value.error && !value.needsReconnect) cache.set(connectionId, { at: Date.now(), value });
  return value;
}

export function forgetBalance(connectionId: string): void {
  cache.delete(connectionId);
}
