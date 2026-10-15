import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const proxy = readFileSync("src/lib/supabase/proxy.ts", "utf8");
const paths = proxy.slice(proxy.indexOf("const PUBLIC_PATHS"), proxy.indexOf("];", proxy.indexOf("const PUBLIC_PATHS")));

describe("paths reachable without signing in", () => {
  it("lets scheduled jobs through, or they are redirected to /login and never run", () => {
    // The daily bank sync and automated deprovisioning are called by Vercel Cron
    // with a bearer secret and no session. Each route checks the secret itself.
    expect(paths).toContain('"/api/cron"');
  });

  it("lets Plaid's signed webhook through, on the exact path only", () => {
    // Plaid has no session; the route verifies the signature itself.
    expect(paths).toContain('"/api/plaid/webhook"');
    expect(paths).not.toContain('"/api/plaid"');
    expect(paths).not.toContain('"/api/plaid/"');
  });

  it("lets Resend's signed webhook through, on the exact path only", () => {
    // Resend has no session; the route verifies the Svix signature itself.
    expect(paths).toContain('"/api/email/webhook"');
    expect(paths).not.toContain('"/api/email"');
    expect(paths).not.toContain('"/api/email/"');
  });

  it("lets a signed-out owner open their unsubscribe link", () => {
    // The token in the link is the credential (0055, DECISIONS #36).
    expect(paths).toContain('"/unsubscribe"');
  });

  it("does not bounce a signed-in person off an unsubscribe link to two-step sign-in or onboarding", () => {
    expect(proxy).toContain('const ALWAYS_REACHABLE_PREFIXES = ["/unsubscribe/"]');
    // The early return sits before both the two-step and the onboarding redirects.
    const early = proxy.indexOf("ALWAYS_REACHABLE_PREFIXES.some");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(proxy.indexOf("if (mfaTarget && !MFA_EXEMPT_PATHS"));
  });

  it("keeps the public trust pages and crawler files reachable", () => {
    for (const p of ["/privacy", "/terms", "/security", "/policies", "/.well-known/security.txt", "/sitemap.xml"]) {
      expect(paths).toContain(`"${p}"`);
    }
  });

  it("does not make the whole API public", () => {
    expect(paths).not.toContain('"/api"');
    expect(paths).not.toContain('"/api/"');
  });
});
