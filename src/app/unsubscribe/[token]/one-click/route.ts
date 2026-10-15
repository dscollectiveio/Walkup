import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidToken } from "@/lib/email-outbox/unsubscribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The RFC 8058 one-click endpoint named in the List-Unsubscribe-Post header.
 * A mail provider POSTs here when a person presses "Unsubscribe" in their
 * inbox. Stops all email from this association for that person. Answers 200
 * for any token, valid or not, so the response does not tell anyone whether a
 * guessed token exists. Reads no cookie and sets none.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (isValidToken(token)) {
    // The anon key only, with no session: whoever calls this is signed out, and no cookie is read or set.
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.rpc("email_unsubscribe", { p_token: token, p_scope: "all", p_subscribe: false });
    if (error) {
      console.error("[walkup-email] one_click_failed", error.code ?? "-");
      return NextResponse.json({ error: "Could not save that. Try again." }, { status: 500, headers: NO_STORE });
    }
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

/** A scanner or a curious click: show the page, change nothing. */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const url = new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url);
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}
