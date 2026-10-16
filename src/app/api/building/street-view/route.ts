import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleKey } from "@/lib/google/places";

// The building's Street View photo for the Association profile card. Proxied
// so the Google key stays on the server. The free metadata call runs first,
// so a billed image request only happens when Google has a photo there.

const METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMAGE_URL = "https://maps.googleapis.com/maps/api/streetview";

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
    const meta = await fetch(`${METADATA_URL}?${new URLSearchParams({ location, source: "outdoor", key })}`, { cache: "no-store" });
    const status = meta.ok ? ((await meta.json()) as { status?: string }).status : null;
    if (status !== "OK") {
      // Reason code only (OK, ZERO_RESULTS, REQUEST_DENIED, ...): never the key or the address.
      console.error("Street View metadata not OK", { http: meta.status, status });
      return new NextResponse(null, { status: 404 });
    }

    const image = await fetch(
      `${IMAGE_URL}?${new URLSearchParams({ location, size: "640x320", scale: "2", fov: "80", source: "outdoor", key })}`,
      { cache: "no-store" },
    );
    if (!image.ok) {
      console.error("Street View image request failed", { http: image.status });
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(await image.arrayBuffer(), {
      headers: {
        "Content-Type": image.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (cause) {
    console.error("Street View fetch failed", cause);
    return new NextResponse(null, { status: 404 });
  }
}
