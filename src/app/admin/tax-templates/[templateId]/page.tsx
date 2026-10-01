import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { FORM_LABEL } from "@/lib/tax/determine";
import { CONTRACTOR_KEYS, LEDGER_KEYS, SETTING_KEYS, type FieldMap } from "@/lib/tax/autofill";
import { ActivationControls, FieldMapForm, type MapRow } from "../template-client";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return <Restricted what="platform settings" />;

  const { data: rows } = await supabase.from("tax_form_templates").select("*").eq("id", templateId).limit(1);
  const t = rows?.[0];
  if (!t) return <Restricted what="this template" />;

  const map = (t.field_map_json ?? {}) as FieldMap;
  const fields = (t.field_names_json ?? []) as { name: string; type: string }[];
  const mapRows: MapRow[] = fields.map((f) => ({
    name: f.name,
    type: f.type,
    label: map[f.name]?.label ?? "",
    section: map[f.name]?.section ?? "",
    source: map[f.name]?.source ?? "",
    rule: map[f.name]?.rule ?? "",
    citation: map[f.name]?.citation ?? "",
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/tax-templates" className="text-[13px] text-mute hover:underline">← All templates</Link>
        <h1 className="mt-2 text-[20px] font-bold tracking-tight text-ink">
          {FORM_LABEL[t.form_code as keyof typeof FORM_LABEL] ?? t.form_code} · {t.tax_year}
        </h1>
        <p className="mt-1 text-[12px] text-mute">
          From <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t.source_url}</a> ·
          fetched {String(t.fetched_at).slice(0, 10)} · SHA-256 <span className="font-mono">{String(t.sha256).slice(0, 16)}…</span> ·{" "}
          {fields.length} AcroForm fields
          {t.verified_at ? ` · verified ${String(t.verified_at).slice(0, 10)}` : " · not verified"}
        </p>
      </div>

      <Card title="Check it" hint="Every text field shows its own name, so you can match each mapping to its box on the printed form.">
        <div className="flex flex-wrap gap-2">
          <a
            href={`/admin/tax-templates/${t.id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
          >
            Open the labeled preview
          </a>
          <a
            href={`/admin/tax-templates/${t.id}/preview?blank=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
          >
            Open the stored official PDF
          </a>
        </div>
        <div className="mt-4">
          <ActivationControls id={t.id} active={t.active} />
        </div>
      </Card>

      <Card title="Map and rules">
        <FieldMapForm
          id={t.id}
          rows={mapRows}
          locked={t.active}
          meta={{
            dueRule: t.due_rule ?? "",
            dueCitation: t.due_rule_citation ?? "",
            instructions: t.filing_instructions ?? "",
            filingCitation: t.filing_citation ?? "",
            notes: t.notes ?? "",
            revision: t.revision ?? "",
          }}
          keys={{ setting: SETTING_KEYS, ledger: LEDGER_KEYS, contractors: CONTRACTOR_KEYS }}
        />
      </Card>
    </div>
  );
}
