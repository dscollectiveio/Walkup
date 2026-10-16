import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleKey } from "@/lib/google/places";

// The building's map view for the Association profile card: a Google map with
// a pin on the address. Proxied so the Google key stays on the server. The
// address always comes from the signed-in person's own association row (RLS),
// never from the query string.

const IMAGE_URL = "https://maps.googleapis.com/maps/api/staticmap";

export async function GET() {
  const key = googleKey();
  if (!key) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("associations")
    .select("street_address, city, state_code, postal_code")
    .order("created_at")
    .order("id")
    .limit(1);
  const a = rows?.[0];
  if (!a?.street_address) return new NextResponse(null, { status: 404 });

  const location = [a.street_address, a.city, [a.state_code, a.postal_code].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  try {
    const params = new URLSearchParams({
      center: location,
      zoom: "17",
      size: "640x320",
      scale: "2",
      maptype: "roadmap",
      markers: `color:0xD9A441|${location}`,
      key,
    });
    const image = await fetch(`${IMAGE_URL}?${params}`, { cache: "no-store" });
    if (!image.ok) {
      // Status only: never the key or the address.
      console.error("Static map request failed", { http: image.status });
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(await image.arrayBuffer(), {
      headers: {
        "Content-Type": image.headers.get("content-type") ?? "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (cause) {
    console.error("Static map fetch failed", cause);
    return new NextResponse(null, { status: 404 });
  }
}
