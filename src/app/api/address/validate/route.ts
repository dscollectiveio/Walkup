import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { takeToken } from "@/lib/security/rate-limit";
import { validateAddress } from "@/lib/address/validate";

export const dynamic = "force-dynamic";

/**
 * GET /api/address/validate?q=2158 N Damen Ave Unit 3, Chicago, IL 60647
 * Checks the address against USPS data (Google Address Validation). Signed in
 * only, and limited, because each call can be a paid Google request.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const limited = takeToken(`address-check:${user.id}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ status: "unavailable", standardized: null }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 6 || !/\d/.test(q)) return NextResponse.json({ status: "unavailable", standardized: null });
  return NextResponse.json(await validateAddress(q));
}
