import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { takeToken } from "@/lib/security/rate-limit";
import { googleResolve, suggestAddresses } from "@/lib/address/suggest";

export const dynamic = "force-dynamic";

const ADDRESS_CALLS_PER_MINUTE = 30;

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

  // Each call can spend a paid Google Places request: 30 a minute per person is far more than typing needs.
  const limited = takeToken(`address:${user.id}`, ADDRESS_CALLS_PER_MINUTE, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many lookups. Wait a minute." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const id = request.nextUrl.searchParams.get("id");
  if (id && (id.length > 300 || !/^[A-Za-z0-9_-]+$/.test(id))) {
    return NextResponse.json({ error: "Couldn't load that address." }, { status: 400 });
  }
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
