"use client";

/**
 * Carries a Plaid Link token across an OAuth redirect. An OAuth institution
 * (most large US banks in production) sends the browser away and back;
 * Plaid requires re-opening Link with the *same* link token plus
 * receivedRedirectUri, not a freshly minted one. localStorage, not
 * sessionStorage — the redirect can land in a different browsing context.
 */
const STORAGE_KEY = "walkup:plaid-link-token";

export function storeLinkTokenForOAuth(linkToken: string) {
  try {
    localStorage.setItem(STORAGE_KEY, linkToken);
  } catch {
    // Best-effort — a blocked localStorage just means the OAuth round trip
    // won't survive; non-OAuth institutions are unaffected either way.
  }
}

export function takeLinkTokenForOAuth(): string | null {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    return token;
  } catch {
    return null;
  }
}

export function clearLinkTokenForOAuth() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage isn't reachable.
  }
}
