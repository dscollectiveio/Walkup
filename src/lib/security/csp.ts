/**
 * The Content-Security-Policy, built fresh for every request so scripts can
 * carry a one-time nonce. With `'strict-dynamic'`, only scripts that carry the
 * nonce (Next's own and the two inline ones we write) — and scripts those
 * load — run; an injected `<script>` or an `onerror=` handler is refused by
 * the browser, which is what makes a cross-site-scripting bug much harder to
 * turn into a stolen session.
 *
 * Everything else is closed by default: no framing of the site (clickjacking),
 * no plugins, no outside form targets, no connections except our own origin,
 * Supabase and Plaid. Plaid Link needs its script and an iframe from
 * cdn.plaid.com. Styles keep 'unsafe-inline' because React and Tailwind emit
 * inline style attributes, which can't carry a nonce; style injection can't
 * run code.
 */
export function buildCsp({
  nonce,
  supabaseUrl,
  dev,
  framedBySelf = false,
}: {
  nonce: string;
  supabaseUrl: string | undefined;
  dev: boolean;
  /** Only the document preview route, which the Documents page frames from its own origin. */
  framedBySelf?: boolean;
}): string {
  let supabase: string[] = [];
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      supabase = [u.origin, `wss://${u.host}`];
    }
  } catch {
    // Misconfigured URL: the app can't reach Supabase anyway; don't widen the policy.
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "https://cdn.plaid.com", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Signed Storage URLs for ticket photos. Our own project only.
    "img-src": ["'self'", "data:", "blob:", ...(supabase.length ? [supabase[0]] : [])],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...supabase, "https://*.plaid.com", ...(dev ? ["ws://localhost:*", "http://localhost:*"] : [])],
    "frame-src": ["'self'", "https://cdn.plaid.com"],
    "frame-ancestors": [framedBySelf ? "'self'" : "'none'"],
    "base-uri": ["'self'"],
    // A billing server action redirects to Stripe's hosted pages, and Chrome
    // applies form-action to that redirect (subscriptions plan 2.5).
    "form-action": ["'self'", "https://checkout.stripe.com", "https://billing.stripe.com"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };

  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

/** A fresh, unguessable nonce for one request. */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
