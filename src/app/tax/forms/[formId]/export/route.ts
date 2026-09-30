import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { concatPdfs, coverSheet, fillForm } from "@/lib/tax/pdf";
import { FORM_LABEL, run1120hTests, type FormCode } from "@/lib/tax/determine";
import { storeGeneratedDocument } from "@/lib/documents/store-generated";
import { loadTaxContext } from "../../../data";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  setting: "Association settings",
  ledger: "Your ledger",
  contractors: "Contractor payments",
  calculated: "Calculated",
  manual: "Entered by hand",
};

/**
 * ?kind=signable — the official PDF filled and flattened, behind a cover sheet.
 * ?kind=editable — the same, not flattened, so a CPA can change it.
 * ?kind=worksheet — every field, its value, its source and the records behind
 *                   it, plus the 1120-H tests. Works even before a template
 *                   exists — it's the fallback when the form isn't ready.
 * Each is also filed in the Document Hub against the form. Walkup never files
 * anything itself.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  const kind = request.nextUrl.searchParams.get("kind") ?? "worksheet";
  const supabase = await createClient();

  const { data: forms } = await supabase
    .from("tax_forms")
    .select("id, association_id, form_code, tax_year, status, due_on, determination, determination_reason, template_id, vendors(name)")
    .eq("id", formId)
    .limit(1);
  const form = forms?.[0];
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  const { data: canRead } = await supabase.rpc("can_read_financials", { assoc: form.association_id });
  if (canRead !== true) return NextResponse.json({ error: "Board members and the accountant only." }, { status: 403 });
  const { data: isBoard } = await supabase.rpc("is_board", { assoc: form.association_id });

  const [{ data: fields }, { data: associations }] = await Promise.all([
    supabase
      .from("tax_form_fields")
      .select("pdf_field_name, label, section, citation, value, source, source_ref_json, confidence, confirmed_at, leave_blank")
      .eq("tax_form_id", formId)
      .order("section")
      .order("label"),
    supabase.from("associations").select("display_name, legal_name").limit(1),
  ]);
  const label = FORM_LABEL[form.form_code as FormCode] ?? form.form_code;
  const vendorName = (form.vendors as unknown as { name: string } | null)?.name;
  const baseName = `${label} ${form.tax_year}${vendorName ? ` ${vendorName}` : ""}`.replace(/[/\\?%*:|"<>]/g, "-");

  if (kind === "worksheet") {
    const ctx = await loadTaxContext(supabase);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fields");
    ws.columns = [
      { header: "Section", key: "section", width: 16 },
      { header: "Line", key: "label", width: 36 },
      { header: "PDF field", key: "pdf", width: 28 },
      { header: "Value", key: "value", width: 18 },
      { header: "Source", key: "source", width: 22 },
      { header: "Behind it", key: "refs", width: 60 },
      { header: "Cited from", key: "citation", width: 40 },
      { header: "Confirmed", key: "confirmed", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const f of fields ?? []) {
      const refs = f.source_ref_json as Record<string, unknown>;
      ws.addRow({
        section: f.section ?? "",
        label: f.label,
        pdf: f.pdf_field_name,
        value: f.value ?? (f.leave_blank ? "(left blank)" : ""),
        source: SOURCE_LABEL[f.source] ?? f.source,
        refs: JSON.stringify(refs),
        citation: f.citation ?? "",
        confirmed: f.confirmed_at ? "Yes" : "",
      });
    }
    ws.addRow({});
    ws.addRow({ section: "Determination", label: form.determination, refs: form.determination_reason });

    const t = wb.addWorksheet("1120-H tests");
    t.columns = [
      { header: "Test", key: "test", width: 34 },
      { header: "Inputs", key: "inputs", width: 44 },
      { header: "Ratio", key: "ratio", width: 10 },
      { header: "Needs", key: "needs", width: 10 },
      { header: "Result", key: "result", width: 12 },
      { header: "Threshold source", key: "src", width: 48 },
    ];
    t.getRow(1).font = { bold: true };
    if (ctx) {
      const tests = run1120hTests(ctx.input) ?? [];
      const fig = ctx.input.figures;
      for (const test of tests) {
        t.addRow({
          test: test.key === "income" ? "Exempt-function income ÷ gross income" : "Exempt-function spending ÷ total spending",
          inputs:
            test.key === "income"
              ? `${(fig.exemptIncomeCents / 100).toFixed(2)} ÷ ${(fig.grossIncomeCents / 100).toFixed(2)}`
              : `${(fig.exemptExpendituresCents / 100).toFixed(2)} ÷ ${(fig.totalExpendituresCents / 100).toFixed(2)}`,
          ratio: test.ratio === null ? "n/a" : `${(test.ratio * 100).toFixed(1)}%`,
          needs: `${(test.threshold * 100).toFixed(0)}%`,
          result: test.passed ? "Pass" : "Fail",
          src: `${test.sourceUrl ?? ""}${test.thresholdVerified ? "" : " (not yet verified)"}`,
        });
      }
    }
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const filename = `${baseName} worksheet.xlsx`;
    if (isBoard === true) {
      const stored = await storeGeneratedDocument(supabase, {
        associationId: form.association_id,
        bytes,
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        categorySlug: "tax_form",
        title: `${label} ${form.tax_year} — CPA worksheet`,
        link: { targetTable: "tax_forms", targetId: formId, relation: "worksheet" },
      });
      if ("id" in stored) await supabase.from("tax_forms").update({ worksheet_document_id: stored.id }).eq("id", formId);
    }
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Both PDF kinds need the verified official template.
  if (!form.template_id) {
    return NextResponse.json({ error: `The ${form.tax_year} form isn't ready in Walkup yet. Export the CPA worksheet instead.` }, { status: 409 });
  }
  if (kind === "signable" && !["ready_to_sign", "filed"].includes(form.status)) {
    return NextResponse.json({ error: "Every figure needs confirming before the form can be exported to sign." }, { status: 409 });
  }
  const { data: templates } = await supabase
    .from("tax_form_templates")
    .select("storage_path, source_url, due_rule_citation, filing_instructions, filing_citation, active")
    .eq("id", form.template_id)
    .limit(1);
  const template = templates?.[0];
  if (!template?.active) return NextResponse.json({ error: "This form's template is no longer active." }, { status: 409 });
  const { data: blob, error: dlError } = await supabase.storage.from("tax-templates").download(template.storage_path);
  if (dlError || !blob) return NextResponse.json({ error: "The official form couldn't be read." }, { status: 500 });

  const values = Object.fromEntries(
    (fields ?? []).filter((f) => f.value !== null && f.value !== "").map((f) => [f.pdf_field_name, f.value as string]),
  );
  const flatten = kind === "signable";
  const filled = await fillForm(new Uint8Array(await blob.arrayBuffer()), values, { flatten });
  const bytes = flatten
    ? await concatPdfs([
        await coverSheet({
          formLabel: label,
          associationName: associations?.[0]?.legal_name ?? associations?.[0]?.display_name ?? "",
          taxYear: form.tax_year,
          dueOn: form.due_on,
          dueCitation: template.due_rule_citation,
          instructions: template.filing_instructions,
          instructionsCitation: template.filing_citation,
          sourceUrl: template.source_url,
        }),
        filled,
      ])
    : filled;

  const filename = `${baseName} ${flatten ? "to sign" : "editable"}.pdf`;
  if (isBoard === true) {
    const stored = await storeGeneratedDocument(supabase, {
      associationId: form.association_id,
      bytes,
      filename,
      mimeType: "application/pdf",
      categorySlug: "tax_form",
      title: `${label} ${form.tax_year} — ${flatten ? "ready to sign" : "editable, for a CPA"}`,
      link: { targetTable: "tax_forms", targetId: formId, relation: flatten ? "signable" : "editable" },
    });
    if ("id" in stored) {
      await supabase
        .from("tax_forms")
        .update(flatten ? { signable_document_id: stored.id } : { editable_document_id: stored.id })
        .eq("id", formId);
    }
  }
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
