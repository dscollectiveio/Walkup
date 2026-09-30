import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { labeledPreview } from "@/lib/tax/pdf";

export const dynamic = "force-dynamic";

/** The stored official PDF, optionally with each field labeled by its own name. Platform admin only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return NextResponse.json({ error: "Platform admin only." }, { status: 403 });

  const { data: rows } = await supabase.from("tax_form_templates").select("storage_path, form_code, tax_year").eq("id", templateId).limit(1);
  const t = rows?.[0];
  if (!t) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const { data: blob, error } = await supabase.storage.from("tax-templates").download(t.storage_path);
  if (error || !blob) return NextResponse.json({ error: "The stored PDF couldn't be read." }, { status: 500 });

  const raw = new Uint8Array(await blob.arrayBuffer());
  const bytes = request.nextUrl.searchParams.get("blank") ? raw : await labeledPreview(raw);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${t.form_code}-${t.tax_year}${request.nextUrl.searchParams.get("blank") ? "" : "-labeled"}.pdf"`,
    },
  });
}
