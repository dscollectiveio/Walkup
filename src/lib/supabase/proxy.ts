import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PENDING_INVITE_COOKIE } from "@/lib/invite-cookie";

// Set once we've seen this user's persons row, so later requests skip that
// query. Convenience only (like the redirect it feeds): pages already degrade
// gracefully for someone with no association, and RLS is the real check.
const MEMBER_COOKIE = "walkup.member";

// /invite is public because a redeemer may not have an account yet — the
// invite page itself handles sign-up, and the redemption RPC is the real
// authorization check, not this list. /security, /privacy, and /policies
// are public because they're static trust pages (no data access) — a
// prospective board reads them before deciding to sign up at all, and
// /privacy specifically must be reachable pre-signup since signup requires
// agreeing to it.
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/invite", "/security", "/privacy", "/policies"];

// Reachable while signed in but not yet at AAL2, so a user can actually
// complete enrollment or the challenge instead of being redirected in place.
const MFA_EXEMPT_PATHS = ["/account/mfa", "/login/mfa-challenge"];

// Reachable once AAL2 is satisfied but before the caller has a persons row
// anywhere — creating a building, or redeeming an invite into one.
const ONBOARDING_EXEMPT_PATHS = ["/onboarding", "/invite"];

/**
 * Refreshes the auth token on every request and redirects unauthenticated
 * traffic to /login, signed-in-but-not-MFA'd traffic to enrollment or a
 * challenge, and MFA'd-but-association-less traffic to onboarding.
 *
 * The redirect is convenience, not security, for the auth check — every
 * table is behind RLS, so an unauthenticated request that slipped past this
 * would read nothing anyway. The MFA check is different: migration 0025
 * makes AAL2 a real database-level requirement (via session_is_aal2(), wired
 * into has_role_in/owned_unit_ids/current_person_id), so this redirect is a
 * UX convenience layered on top of an enforcement that holds even if this
 * file is ever misconfigured or bypassed. The onboarding check is convenience
 * too — every page that reads an association already fails gracefully
 * ("No association is visible to you.") for someone with none; this just
 * saves them from landing on that message instead of somewhere useful.
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

  // getClaims verifies the access token's signature locally (no round trip to
  // the auth server) and refreshes it when it has expired — the same two jobs
  // getUser did here, without a network call on every navigation. Where the
  // project still uses a shared-secret JWT, supabase-js falls back to asking
  // the auth server itself, so this is never weaker than getUser was.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null;

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

  // Only asked once MFA is fully satisfied — no point querying persons for
  // someone who's about to be redirected to enrollment anyway. persons_select
  // already permits "my own row" at AAL1 (DECISIONS #26's one accepted gap),
  // so this read is always safe regardless of AAL, it's just wasted work here.
  let needsOnboarding = false;
  if (!mfaTarget && request.cookies.get(MEMBER_COOKIE)?.value !== user.id) {
    const { data: ownPerson } = await supabase
      .from("persons")
      .select("id")
      .eq("auth_user_id", user.id)
      .limit(1);
    needsOnboarding = !ownPerson || ownPerson.length === 0;
    if (!needsOnboarding) {
      response.cookies.set(MEMBER_COOKIE, user.id, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
  }

  // A pending invite (set by signUp() in login/actions.ts) takes the place of
  // the generic "create a building" page — someone who signed up from an
  // invite link should redeem that invite, not start a new building.
  const pendingInvite = request.cookies.get(PENDING_INVITE_COOKIE)?.value;
  const onboardingTarget = pendingInvite ? `/invite/${pendingInvite}` : "/onboarding";

  if (path === "/login" || path === "/signup") {
    const url = request.nextUrl.clone();
    url.pathname = mfaTarget ?? (needsOnboarding ? onboardingTarget : "/");
    return NextResponse.redirect(url);
  }

  if (mfaTarget && !MFA_EXEMPT_PATHS.includes(path)) {
    const url = request.nextUrl.clone();
    url.pathname = mfaTarget;
    return NextResponse.redirect(url);
  }

  if (
    !mfaTarget &&
    needsOnboarding &&
    !ONBOARDING_EXEMPT_PATHS.some((p) => path.startsWith(p))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = onboardingTarget;
    return NextResponse.redirect(url);
  }

  return response;
}
