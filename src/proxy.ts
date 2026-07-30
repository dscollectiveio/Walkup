import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every rendered route. Refreshes the Supabase auth token and
 * redirects unauthenticated traffic to /login.
 *
 * Named `proxy`, not `middleware`: Next 16 deprecated the middleware file
 * convention and renamed it. Same execution model.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
