import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Where a signup/invite confirmation email links to. Supabase's default
 * "Confirm signup" template points at Supabase's own hosted verify endpoint
 * instead (`{{ .ConfirmationURL }}`) — that link sets session tokens in a URL
 * fragment on redirect, which a server component can never see (fragments
 * never reach the server). This route needs the template changed to
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
 * so verifyOtp() below can exchange it for a real cookie-based session
 * server-side — the standard pattern for @supabase/ssr, not a Walkup-specific
 * design.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("error", "confirmation_failed");
  return NextResponse.redirect(url);
}
