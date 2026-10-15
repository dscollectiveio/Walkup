import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildCsp, newNonce } from "@/lib/security/csp";

/**
 * Runs before every rendered route. Gives the request a CSP nonce, refreshes
 * the Supabase auth token and redirects unauthenticated traffic to /login.
 *
 * Named `proxy`, not `middleware`: Next 16 deprecated the middleware file
 * convention and renamed it. Same execution model.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    dev: process.env.NODE_ENV !== "production",
    // The Documents page frames its own preview route; nothing else may be framed.
    framedBySelf: /^\/documents\/[^/]+\/preview$/.test(request.nextUrl.pathname),
  });
  // Next reads the nonce from the request's CSP header and stamps it on its
  // own scripts; the layout reads x-nonce for the two inline ones.
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);

  const response = await updateSession(request);
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|txt)$).*)",
  ],
};
