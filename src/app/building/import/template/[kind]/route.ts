import { NextResponse, type NextRequest } from "next/server";
import { kindFromSlug } from "@/lib/import/kinds";
import { importViewer } from "@/lib/import/server";
import { buildTemplate } from "@/lib/import/templates";

export const dynamic = "force-dynamic";

/**
 * The downloadable templates (import-spec 4.1). Route handlers do not inherit
 * a page's access check, so it is repeated here: board admins only, with a
 * plain JSON answer for anyone else. The dropdowns in the Excel version come
 * from this building's own funds, units and accounts.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) return NextResponse.json({ error: "There is no template with that name." }, { status: 404 });
  const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const { supabase, associationId, role } = await importViewer();
  if (!associationId) return NextResponse.json({ error: "No association is visible to you." }, { status: 403 });
  if (role !== "board_admin") return NextResponse.json({ error: "Importing is for board admins." }, { status: 403 });

  const [{ data: funds }, { data: units }, { data: accounts }] = await Promise.all([
    supabase.from("funds").select("name").eq("association_id", associationId).order("name"),
    supabase.from("units").select("label").eq("association_id", associationId).order("sort_order"),
    supabase
      .from("accounts")
      .select("code, name, type, is_active")
      .eq("association_id", associationId)
      .eq("is_active", true)
      .in("type", ["asset", "liability", "equity"])
      .order("code"),
  ]);

  const template = await buildTemplate(kind, format, {
    fundNames: (funds ?? []).map((f) => String(f.name)),
    unitLabels: (units ?? []).map((u) => String(u.label)),
    accountLabels: (accounts ?? []).filter((a) => a.code !== "1200" && a.code !== "1250").map((a) => String(a.name)),
  });
  return new NextResponse(template.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": template.contentType,
      "Content-Disposition": `attachment; filename="${template.filename.replace(/[^A-Za-z0-9._-]/g, "-")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
