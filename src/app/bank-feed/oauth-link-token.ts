"use client";

/**
 * Carries a Plaid Link token across an OAuth redirect. An OAuth institution
 * (most large US banks in production) sends the browser away and back;
 * Plaid requires re-opening Link with the *same* link token plus
 * receivedRedirectUri, not a freshly minted one. localStorage, not
 * sessionStorage — the redirect can land in a different browsing context.
 *
 * A reconnect (Link's update mode) carries the connection id alongside, so
 * the return page knows to mark that connection repaired rather than try to
 * create a new one.
 */
const STORAGE_KEY = "walkup:plaid-link-token";
const RECONNECT_KEY = "walkup:plaid-reconnect-connection";

export function storeLinkTokenForOAuth(linkToken: string, reconnectConnectionId?: string) {
  try {
    localStorage.setItem(STORAGE_KEY, linkToken);
    if (reconnectConnectionId) localStorage.setItem(RECONNECT_KEY, reconnectConnectionId);
    else localStorage.removeItem(RECONNECT_KEY);
  } catch {
    // Best-effort — a blocked localStorage just means the OAuth round trip
    // won't survive; non-OAuth institutions are unaffected either way.
  }
}

export function takeLinkTokenForOAuth(): { linkToken: string; reconnectConnectionId: string | null } | null {
  try {
    const linkToken = localStorage.getItem(STORAGE_KEY);
    const reconnectConnectionId = localStorage.getItem(RECONNECT_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RECONNECT_KEY);
    return linkToken ? { linkToken, reconnectConnectionId } : null;
  } catch {
    return null;
  }
}

export function clearLinkTokenForOAuth() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RECONNECT_KEY);
  } catch {
    // Nothing to clean up if storage isn't reachable.
  }
}
