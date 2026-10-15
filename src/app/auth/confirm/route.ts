import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/security/safe-next";

/**
 * Where every emailed link lands: sign-up confirmation, a resent
 * confirmation, a password reset, an invite.
 *
 * Two shapes arrive here, and both become a cookie session server-side:
 *  - ?code=… — Supabase's default templates ({{ .ConfirmationURL }}) verify
 *    the link on Supabase's side and redirect here with a PKCE code, which
 *    only the browser that started the flow can exchange (its cookie holds
 *    the verifier).
 *  - ?token_hash=…&type=… — a template customised to
 *    {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup,
 *    which works from any browser.
 *
 * Then on to `next` (same-site paths only), where proxy.ts's usual
 * MFA → onboarding routing takes over.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  // Only a path on this site — never "//evil.example", "/\\evil.example" or a full URL.
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    // Supabase has already confirmed the email by the time it sends a code;
    // the exchange fails when the link is opened in a different browser.
    // Signing in finishes the job.
    const url = new URL("/login", request.url);
    url.searchParams.set("notice", next === "/reset-password" ? "reset_other_browser" : "confirmed_elsewhere");
    return NextResponse.redirect(url);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("error", "confirmation_failed");
  return NextResponse.redirect(url);
}
