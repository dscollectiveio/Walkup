import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { reconcileOpenCheckouts } from "@/lib/payments/reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where Stripe Checkout sends the owner back (DECISIONS #57). r=done: ask
 * Stripe how it ended and record it. r=cancel: close that Checkout at Stripe
 * so it can't be paid later, then free the unit. Either way only the signed-in
 * owner's own payments are touched (my_open_online_checkouts), and nothing
 * here reaches the ledger.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const paymentId = q.get("p") ?? "";
  const canceled = q.get("r") === "cancel";
  const url = new URL("/owner/pay", request.nextUrl.origin);
  url.hash = "pay-online";

  const viewer = await getViewer();
  if (viewer && UUID.test(paymentId)) {
    const supabase = await createClient();
    await reconcileOpenCheckouts(supabase, viewer.associationId, canceled ? { cancel: paymentId } : {});
  }
  url.searchParams.set("paid", canceled ? "canceled" : "started");
  return NextResponse.redirect(url, 303);
}
