import type { NextConfig } from "next";

/**
 * Headers every response carries, besides the per-request Content-Security-
 * Policy (src/proxy.ts, which needs a fresh nonce each time).
 */
const SECURITY_HEADERS = [
  // HTTPS only, for two years, subdomains included. Not submitted to the
  // browser preload list: that is hard to undo.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Also covered by CSP frame-ancestors; kept for old browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these; keep it that way even if a script is injected.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  // Keep other sites' windows from holding a reference to ours; popups we open
  // (bank sign-in) still work.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  experimental: {
    // Keep a visited page in the browser's router cache for 30 seconds, so
    // switching back to it (or back and forth between two tabs of the app)
    // is instant instead of a fresh server render. Every server action that
    // changes data calls revalidatePath, which clears this cache, so a save
    // is never hidden behind a stale page.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
