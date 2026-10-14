import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { googleResolve, suggestAddresses } from "@/lib/address/suggest";

export const dynamic = "force-dynamic";

/**
 * Address autocomplete for onboarding.
 *   GET /api/address?q=2158 n dam   → { suggestions: [{ label, placeId, parts }] }
 *   GET /api/address?id=<placeId>   → { parts } (Google suggestions only)
 * Signed-in only (so it can't be used as a free lookup service); reachable
 * before the person has a building, which proxy.ts allows for this path.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const parts = await googleResolve(id);
    return parts ? NextResponse.json({ parts }) : NextResponse.json({ error: "Couldn't load that address." }, { status: 404 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ suggestions: await suggestAddresses(q.slice(0, 120)) });
  } catch {
    // Suggestions are a convenience; the form works without them.
    return NextResponse.json({ suggestions: [], unavailable: true });
  }
}
