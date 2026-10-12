import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { concatPdfs, coverSheet, draftCover, fillForm, keepPages, mirrorValues, prependCover } from "@/lib/tax/pdf";
import { FORM_LABEL, run1120hTests, type FormCode } from "@/lib/tax/determine";
import { figuresPack } from "@/lib/tax/figures";
import { dateWords } from "@/lib/tax/copy";
import { storeGeneratedDocument } from "@/lib/documents/store-generated";
import { isInformationReturn, loadTaxContext } from "../../../data";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  setting: "Association settings",
  ledger: "Your ledger",
  contractors: "Contractor payments",
  calculated: "Calculated",
  manual: "Entered by hand",
};

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const refuse = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/**
 * HTTP headers must be plain ASCII (an em dash or an accented contractor name
 * in a header throws and the download 500s), so send an ASCII fallback plus
 * the real name in the RFC 5987 form — as financial-statements/export/pdf does.
 */
function attachment(filename: string): string {
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "-");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * ?kind=worksheet — the figures pack from the records (always available, even
 *                   with no template), then every form line with its value,
 *                   source and the records behind it, then the 1120-H tests.
 * ?kind=editable  — the official PDF filled, not flattened, so a CPA can change
 *                   it; behind a "draft" cover while the board hasn't confirmed
 *                   every line.
 * ?kind=signable  — the official PDF filled and flattened, behind the cover
 *                   sheet that says what to sign and where to send it. For a
 *                   1099-NEC this is the contractor's copies only.
 * Each is also filed in the Document Hub against the form. Everything reads
 * the context for the form's own year. Walkup never files anything itself.
 * The filenames are also spelled in the form page (packetNames) — the email
 * draft names them — so change both together.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  const kind = request.nextUrl.searchParams.get("kind") ?? "worksheet";
  if (kind !== "worksheet" && kind !== "editable" && kind !== "signable") return refuse("Unknown export.", 400);
  const supabase = await createClient();

  const { data: forms } = await supabase
    .from("tax_forms")
    .select("id, association_id, form_code, tax_year, vendor_id, fiscal_year_id, status, due_on, determination, determination_reason, template_id, vendors(name)")
    .eq("id", formId)
    .limit(1);
  const form = forms?.[0];
  if (!form) return refuse("Form not found.", 404);
  const { data: canRead } = await supabase.rpc("can_read_financials", { assoc: form.association_id });
  if (canRead !== true) return refuse("Board members and the accountant only.", 403);
  const { data: isBoard } = await supabase.rpc("is_board", { assoc: form.association_id });

  const [{ data: fields }, ctx] = await Promise.all([
    supabase
      .from("tax_form_fields")
      .select("pdf_field_name, label, section, citation, value, source, source_ref_json, confidence, confirmed_at, leave_blank")
      .eq("tax_form_id", formId)
      .order("section")
      .order("label"),
    loadTaxContext(supabase, {
      fiscalYearId: form.fiscal_year_id ?? undefined,
      contractorYear: isInformationReturn(form.form_code) ? form.tax_year : undefined,
    }),
  ]);
  if (!ctx) return refuse("No fiscal year is set up yet.", 404);
  if (form.fiscal_year_id && ctx.fiscalYear.id !== form.fiscal_year_id) return refuse("This form's fiscal year isn't on file any more.", 409);

  const label = FORM_LABEL[form.form_code as FormCode] ?? form.form_code;
  const vendorName = (form.vendors as unknown as { name: string } | null)?.name ?? null;
  const baseName = `${label} ${form.tax_year}${vendorName ? ` ${vendorName}` : ""}`.replace(/[/\\?%*:|"<>]/g, "-");
  const associationName = ctx.association.legal_name || ctx.association.display_name;
  // The date every reminder shows — a verified rule, else the labeled estimate — else what was recorded when the form started.
  const deadlineKey = form.vendor_id ? `${form.form_code}:${form.tax_year}:${form.vendor_id}` : `${form.form_code}:${form.tax_year}`;
  const deadline = ctx.deadlines.find((d) => d.key === deadlineKey);
  const dueOn = deadline?.dueOn ?? form.due_on ?? null;
  const dueWords = deadline
    ? deadline.basis === "verified"
      ? deadline.citation
      : deadline.note
    : form.due_on
      ? "recorded when the form was started — not yet checked against this year's instructions"
      : null;

  if (kind === "worksheet") {
    const wb = new ExcelJS.Workbook();
    const figures = wb.addWorksheet("Figures");
    figures.columns = [
      { header: "Section", key: "section", width: 34 },
      { header: "Line", key: "label", width: 52 },
      { header: "Value", key: "value", width: 30 },
      { header: "Note", key: "note", width: 72 },
    ];
    figures.getRow(1).font = { bold: true };
    for (const section of figuresPack(ctx, { formCode: form.form_code, taxYear: form.tax_year, vendorId: form.vendor_id ?? null })) {
      for (const row of section.rows) figures.addRow({ section: section.title, label: row.label, value: row.value, note: row.note ?? "" });
    }
    figures.addRow({});
    figures.addRow({
      section: "Due date",
      label: dueOn ? dateWords(dueOn) : "Not on file — ask your CPA",
      value: deadline ? deadline.basis : form.due_on ? "recorded at start" : "",
      note: dueWords ?? "",
    });
    figures.addRow({ section: "Determination", label: form.determination, value: "", note: form.determination_reason });

    if ((fields ?? []).length > 0) {
      const ws = wb.addWorksheet("Fields");
      ws.columns = [
        { header: "Section", key: "section", width: 30 },
        { header: "Line", key: "label", width: 48 },
        { header: "PDF field", key: "pdf", width: 40 },
        { header: "Value", key: "value", width: 18 },
        { header: "Source", key: "source", width: 22 },
        { header: "Behind it", key: "refs", width: 60 },
        { header: "Cited from", key: "citation", width: 60 },
        { header: "Confirmed", key: "confirmed", width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const f of fields ?? []) {
        ws.addRow({
          section: f.section ?? "",
          label: f.label,
          pdf: f.pdf_field_name,
          value: f.value ?? (f.leave_blank ? "(left blank)" : ""),
          source: SOURCE_LABEL[f.source] ?? f.source,
          refs: JSON.stringify(f.source_ref_json as Record<string, unknown>),
          citation: f.citation ?? "",
          confirmed: f.confirmed_at ? "Yes" : "",
        });
      }
    }

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
    const fig = ctx.input.figures;
    for (const test of run1120hTests(ctx.input) ?? []) {
      t.addRow({
        test: test.key === "income" ? "Exempt-function income ÷ gross income" : "Exempt-function spending ÷ total spending",
        inputs:
          test.key === "income"
            ? `${(fig.exemptIncomeCents / 100).toFixed(2)} ÷ ${(fig.grossIncomeCents / 100).toFixed(2)}`
            : `${(fig.exemptExpendituresCents / 100).toFixed(2)} ÷ ${(fig.totalExpendituresCents / 100).toFixed(2)}`,
        ratio: test.ratio === null ? "n/a" : `${(test.ratio * 100).toFixed(1)}%`,
        needs: `${(test.threshold * 100).toFixed(0)}%`,
        result: test.passed ? "Pass" : "Fail",
        src: `${test.sourceUrl ?? ""}${test.thresholdVerified ? "" : " (not yet checked by a person)"}`,
      });
    }

    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const filename = `${baseName} worksheet.xlsx`;
    if (isBoard === true) {
      const stored = await storeGeneratedDocument(supabase, {
        associationId: form.association_id,
        bytes,
        filename,
        mimeType: XLSX_TYPE,
        categorySlug: "tax_form",
        title: `${label} ${form.tax_year} — figures worksheet`,
        link: { targetTable: "tax_forms", targetId: formId, relation: "worksheet" },
      });
      if ("id" in stored) await supabase.from("tax_forms").update({ worksheet_document_id: stored.id }).eq("id", formId);
    }
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": attachment(filename) },
    });
  }

  // Both PDF kinds need the active template behind the form's lines — and a PDF one.
  const template = ctx.templates.find((t) => t.id === form.template_id) ?? null;
  if (!template) {
    return refuse(
      form.template_id
        ? "This form's template is no longer active. Download your figures instead."
        : `Walkup hasn't checked the ${form.tax_year} official form yet. Download your figures instead.`,
      409,
    );
  }
  if (template.kind === "link_only") return refuse("This form is filed online; there is no PDF to fill.", 409);
  if (kind === "signable" && form.status !== "ready_to_sign" && form.status !== "filed") {
    return refuse("Every figure needs confirming before the form can be exported to sign.", 409);
  }
  const { data: stored } = await supabase
    .from("tax_form_templates")
    .select("storage_path, source_url, filing_instructions, filing_citation")
    .eq("id", template.id)
    .limit(1);
  const file = stored?.[0];
  if (!file?.storage_path) return refuse("The official form couldn't be read.", 500);
  const { data: blob, error: dlError } = await supabase.storage.from("tax-templates").download(file.storage_path);
  if (dlError || !blob) return refuse("The official form couldn't be read.", 500);

  // Fill by exact field name; a value also lands on its twin copy (Copy 2 says
  // what Copy B says); then only the pages the template keeps — the recipient
  // copies of a 1099, never Copy A.
  const entered = Object.fromEntries((fields ?? []).filter((f) => f.value !== null && f.value !== "").map((f) => [f.pdf_field_name, f.value as string]));
  const values = mirrorValues(entered, template.mirror);
  const flatten = kind === "signable";
  let filled = await fillForm(new Uint8Array(await blob.arrayBuffer()), values, { flatten });
  if (template.includePages && template.includePages.length > 0) {
    try {
      filled = await keepPages(filled, template.includePages);
    } catch {
      return refuse("The pages this template keeps aren't in the official PDF. A platform admin needs to check the template before it can be exported.", 409);
    }
  }

  // The cover goes on after the pages are settled. A signable packet is a new
  // document (the form is flat); an editable one keeps the form's own document
  // so its fields survive — prependCover, never concatPdfs.
  const draft = form.status === "draft" || form.status === "in_review";
  const bytes = flatten
    ? await concatPdfs([
        await coverSheet({
          formLabel: label,
          associationName,
          taxYear: form.tax_year,
          dueOn: dueOn ? dateWords(dueOn) : null,
          dueCitation: dueWords,
          instructions: file.filing_instructions,
          instructionsCitation: file.filing_citation,
          sourceUrl: file.source_url,
        }),
        filled,
      ])
    : draft
      ? await prependCover(await draftCover({ formLabel: label, associationName, taxYear: form.tax_year }), filled)
      : filled;

  const filename = `${baseName} ${flatten ? "to sign" : "editable"}.pdf`;
  if (isBoard === true) {
    const saved = await storeGeneratedDocument(supabase, {
      associationId: form.association_id,
      bytes,
      filename,
      mimeType: "application/pdf",
      categorySlug: "tax_form",
      title: `${label} ${form.tax_year} — ${flatten ? "ready to sign" : draft ? "draft, editable for a CPA" : "editable, for a CPA"}`,
      link: { targetTable: "tax_forms", targetId: formId, relation: flatten ? "signable" : "editable" },
    });
    if ("id" in saved) {
      await supabase
        .from("tax_forms")
        .update(flatten ? { signable_document_id: saved.id } : { editable_document_id: saved.id })
        .eq("id", formId);
    }
  }
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment(filename) },
  });
}
