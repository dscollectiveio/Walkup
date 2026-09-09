import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

// Reachable while signed in but not yet at AAL2, so a user can actually
// complete enrollment or the challenge instead of being redirected in place.
const MFA_EXEMPT_PATHS = ["/account/mfa", "/login/mfa-challenge"];

/**
 * Refreshes the auth token on every request and redirects unauthenticated
 * traffic to /login, and signed-in-but-not-MFA'd traffic to enrollment or a
 * challenge.
 *
 * The redirect is convenience, not security, for the auth check — every
 * table is behind RLS, so an unauthenticated request that slipped past this
 * would read nothing anyway. The MFA check is different: migration 0025
 * makes AAL2 a real database-level requirement (via session_is_aal2(), wired
 * into has_role_in/owned_unit_ids/current_person_id), so this redirect is a
 * UX convenience layered on top of an enforcement that holds even if this
 * file is ever misconfigured or bypassed.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser, not getSession — this call is what refreshes the token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user) {
    if (isPublic) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const hasVerifiedFactor = aal?.nextLevel === "aal2";
  const challengeCleared = aal?.currentLevel === "aal2";

  const mfaTarget = !hasVerifiedFactor
    ? "/account/mfa"
    : !challengeCleared
      ? "/login/mfa-challenge"
      : null;

  if (path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = mfaTarget ?? "/";
    return NextResponse.redirect(url);
  }

  if (mfaTarget && !MFA_EXEMPT_PATHS.includes(path)) {
    const url = request.nextUrl.clone();
    url.pathname = mfaTarget;
    return NextResponse.redirect(url);
  }

  return response;
}
