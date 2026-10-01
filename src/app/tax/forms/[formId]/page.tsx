import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { FORM_LABEL, FORM_PLAIN, type FormCode } from "@/lib/tax/determine";
import { FieldRow, type FieldView } from "./field-row";
import { MarkFiled, RefreshButton } from "./form-controls";
import { TAX_FOOTER } from "@/lib/tax/copy";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  draft: "Draft",
  in_review: "In review",
  ready_to_sign: "Ready to sign",
  filed: "Filed",
};

function sourceLine(source: string, ref: Record<string, unknown>): { line: string; href: string | null } {
  switch (source) {
    case "setting":
      return { line: `From your settings (${String(ref.setting ?? "").replace(/^association\.|^fiscal_year\./, "").replace(/_/g, " ")})`, href: "/building" };
    case "ledger": {
      const n = Number(ref.count ?? 0);
      return { line: `From your ledger: ${n} transaction${n === 1 ? "" : "s"} (${String(ref.aggregate ?? "").replace(/_/g, " ")})`, href: "/tax#income" };
    }
    case "contractors":
      return { line: `From contractor payments${Array.isArray(ref.expense_ids) ? `: ${(ref.expense_ids as unknown[]).length} payment${(ref.expense_ids as unknown[]).length === 1 ? "" : "s"}` : ""}`, href: "/contractors" };
    case "calculated":
      return { line: `Calculated: ${String(ref.formula ?? "")}`, href: null };
    default:
      return { line: "Entered by hand", href: null };
  }
}

export default async function TaxFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  const supabase = await createClient();
  const { data: forms } = await supabase
    .from("tax_forms")
    .select("id, association_id, form_code, tax_year, determination, determination_reason, status, due_on, filed_on, template_id, vendors(name)")
    .eq("id", formId)
    .limit(1);
  const form = forms?.[0];
  if (!form) return <Restricted what="this tax form" />;

  const [{ data: fields }, { data: isBoard }] = await Promise.all([
    supabase
      .from("tax_form_fields")
      .select("id, pdf_field_name, label, section, citation, value, source, source_ref_json, confidence, proposed_value, confirmed_at, leave_blank")
      .eq("tax_form_id", formId),
    supabase.rpc("is_board", { assoc: form.association_id }),
  ]);
  const canEdit = isBoard === true;
  const locked = form.status === "filed";
  const label = FORM_LABEL[form.form_code as FormCode] ?? form.form_code;
  const vendorName = (form.vendors as unknown as { name: string } | null)?.name;

  const views: (FieldView & { section: string })[] = (fields ?? []).map((f) => {
    const s = sourceLine(f.source, f.source_ref_json as Record<string, unknown>);
    return {
      id: f.id,
      section: f.section ?? "Other",
      label: f.label,
      pdfFieldName: f.pdf_field_name,
      citation: f.citation,
      value: f.value,
      confidence: f.confidence,
      sourceLine: s.line,
      sourceHref: s.href,
      proposedValue: f.proposed_value,
      confirmed: f.confirmed_at !== null,
      leaveBlank: f.leave_blank,
    };
  });
  // Review first, then blanks, then the rest — within each form section.
  const rank = (v: FieldView) =>
    v.proposedValue !== null || (v.confidence === "review" && !v.confirmed) ? 0 : v.value === null && !v.leaveBlank ? 1 : 2;
  const sections = [...new Set(views.map((v) => v.section))].sort();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tax" className="text-[13px] text-mute hover:underline">← Taxes</Link>
        <h1 className="mt-2 text-[20px] font-bold tracking-tight text-ink">
          {label} · {form.tax_year}
          {vendorName ? ` · ${vendorName}` : ""}
        </h1>
        <p className="mt-1 text-mute">{FORM_PLAIN[form.form_code as FormCode] ?? ""}</p>
        <p className="mt-2 text-[13px] text-ink">
          <span className="rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] text-mute">{STATUS_LABEL[form.status]}</span>
          <span className="ml-2">{form.determination_reason}</span>
        </p>
        {form.due_on ? <p className="mt-1 text-[12px] text-mute">Due {form.due_on}</p> : null}
      </div>

      {!form.template_id ? (
        <div className="rounded-xl border border-line bg-paper px-5 py-4 text-[13px]">
          <p className="font-medium text-ink">The {form.tax_year} form isn&rsquo;t ready in Walkup yet.</p>
          <p className="mt-1 text-mute">
            Walkup only fills the official form once someone has checked it. In the meantime, the CPA worksheet has
            the figures from your records and where each came from.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/tax/forms/${formId}/export?kind=worksheet`} className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
              Export the CPA worksheet
            </a>
            {canEdit && !locked ? <RefreshButton formId={formId} /> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {canEdit && !locked ? <RefreshButton formId={formId} /> : null}
            {form.status === "ready_to_sign" || locked ? (
              <a href={`/tax/forms/${formId}/export?kind=signable`} className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
                Export to sign
              </a>
            ) : null}
            <a href={`/tax/forms/${formId}/export?kind=editable`} className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
              Editable PDF for a CPA
            </a>
            <a href={`/tax/forms/${formId}/export?kind=worksheet`} className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
              CPA worksheet
            </a>
            {canEdit && form.status === "ready_to_sign" ? <MarkFiled formId={formId} /> : null}
          </div>
          {locked ? <p className="text-[13px] text-good-text">Filed on {form.filed_on}. The figures are locked.</p> : null}
          {form.status === "in_review" ? (
            <p className="text-[13px] text-mute">
              Confirm each figure, and enter or leave blank anything Walkup couldn&rsquo;t find. The form is ready to sign
              once nothing is left open.
            </p>
          ) : null}

          {sections.map((section) => (
            <section key={section} className="rounded-xl border border-line bg-paper">
              <h2 className="border-b border-line px-5 py-3 font-bold tracking-tight text-ink">{section}</h2>
              <ul className="divide-y divide-line px-5">
                {views
                  .filter((v) => v.section === section)
                  .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
                  .map((v) => (
                    <FieldRow key={v.id} field={v} canEdit={canEdit} locked={locked} />
                  ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <p className="text-[11px] text-mute">{TAX_FOOTER}</p>
    </div>
  );
}
