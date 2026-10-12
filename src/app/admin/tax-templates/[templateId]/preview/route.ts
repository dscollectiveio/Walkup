import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { FieldMap } from "@/lib/tax/autofill";
import { fillForm, keepPages, labeledPreview, mirrorValues } from "@/lib/tax/pdf";

export const dynamic = "force-dynamic";

/**
 * What the sample export writes into each mapped box: the line's own label,
 * so a person can see at a glance that "Payer's name" landed in the payer's
 * name box; a plain amount on money lines; a date; a tick. Not a figure
 * from any building — this is a check of the map, nothing more.
 */
function sampleValues(map: FieldMap): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, entry] of Object.entries(map)) {
    values[name] =
      entry.kind === "checkbox" ? "Yes"
      : entry.kind === "money" ? "1234.56"
      : entry.kind === "date" ? "01/15/2026"
      : entry.label;
  }
  return values;
}

/**
 * The stored official PDF: with each text field labeled by its own name
 * (default), filled with sample values the way a board's export would be
 * (?sample=1), or as published (?blank=1). Platform admin only. A link-only
 * template has no PDF, and says so rather than failing on a null path.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return NextResponse.json({ error: "Platform admin only." }, { status: 403 });

  const { data: rows } = await supabase
    .from("tax_form_templates")
    .select("kind, storage_path, form_code, tax_year, field_map_json, include_pages, mirror_json")
    .eq("id", templateId)
    .limit(1);
  const t = rows?.[0];
  if (!t) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  if (t.kind === "link_only" || !t.storage_path) {
    return NextResponse.json({ error: "This template has no PDF — the form is filed online. There is nothing to preview." }, { status: 409 });
  }
  const { data: blob, error } = await supabase.storage.from("tax-templates").download(t.storage_path);
  if (error || !blob) return NextResponse.json({ error: "The stored PDF couldn't be read." }, { status: 500 });

  const raw = new Uint8Array(await blob.arrayBuffer());
  const mode = request.nextUrl.searchParams.get("blank") ? "blank" : request.nextUrl.searchParams.get("sample") ? "sample" : "labeled";
  let bytes: Uint8Array;
  if (mode === "blank") {
    bytes = raw;
  } else if (mode === "sample") {
    const map = (t.field_map_json ?? {}) as FieldMap;
    const mirror = Array.isArray(t.mirror_json)
      ? (t.mirror_json as unknown[]).flatMap((m) => {
          const pair = m as { from?: unknown; to?: unknown };
          return typeof pair?.from === "string" && typeof pair?.to === "string" ? [{ from: pair.from, to: pair.to }] : [];
        })
      : [];
    const pages = Array.isArray(t.include_pages) ? (t.include_pages as unknown[]).map(Number) : null;
    // The same order as a board's export: mirror, fill, then keep the listed pages. Not flattened, so the boxes stay inspectable.
    const filled = await fillForm(raw, mirrorValues(sampleValues(map), mirror), { flatten: false });
    try {
      bytes = pages ? await keepPages(filled, pages) : filled;
    } catch (cause) {
      return NextResponse.json({ error: `Pages to keep: ${(cause as Error).message}` }, { status: 409 });
    }
  } else {
    bytes = await labeledPreview(raw);
  }
  const suffix = mode === "blank" ? "" : mode === "sample" ? "-sample" : "-labeled";
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${t.form_code}-${t.tax_year}${suffix}.pdf"`,
    },
  });
}
