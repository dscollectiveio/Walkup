import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { FORM_LABEL } from "@/lib/tax/determine";
import { CONTRACTOR_KEYS, LEDGER_KEYS, SETTING_KEYS, type FieldMap } from "@/lib/tax/autofill";
import { includePagesText, mirrorText } from "../rules";
import { ActivationControls, FieldMapForm, type MapRow } from "../template-client";

export const dynamic = "force-dynamic";

const linkBtn = "inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill";

/** What just happened, by code — the detail is in the template's own note, so the address carries no free text. */
const SETUP_NOTE: Record<string, { tone: "good" | "warning" | "neutral"; text: string }> = {
  applied: {
    tone: "good",
    text: "Walkup's suggested map is in place, inactive. Open the labeled preview and the filled sample export, check every mapped line against the printed form and its instructions, then verify and activate.",
  },
  refused: {
    tone: "warning",
    text: "The suggested map was NOT applied — the note below says why. The PDF is stored, inactive; map it by hand against the labeled preview, or wait for an updated suggestion.",
  },
  link_only: {
    tone: "good",
    text: "Link-only template created from Walkup's suggestion, inactive. Open the official page, check the due rule, the filing instructions and the links, then verify and activate.",
  },
  created: { tone: "good", text: "Link-only template saved, inactive. Check the rule and its citation against the official page, then verify and activate." },
  active: { tone: "neutral", text: "This exact file is already an active template, so nothing was changed. Deactivate it first if its map or rules need to change." },
  exists: { tone: "neutral", text: "This file was already stored as a template — here it is." },
};

const NOTE_TONE = {
  good: "border-good-line bg-good-tint text-good-text",
  warning: "border-warning-line bg-warning-tint text-warning-text",
  neutral: "border-line bg-fill text-ink",
};

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ setup?: string }>;
}) {
  const { templateId } = await params;
  const { setup } = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return <Restricted what="platform settings" />;

  const { data: rows } = await supabase.from("tax_form_templates").select("*").eq("id", templateId).limit(1);
  const t = rows?.[0];
  if (!t) return <Restricted what="this template" />;

  const kind: "pdf" | "link_only" = t.kind === "link_only" ? "link_only" : "pdf";
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
    kind: map[f.name]?.kind ?? "",
    review: map[f.name]?.review === true,
    zeroOk: map[f.name]?.zeroOk === true,
    hint: map[f.name]?.hint ?? "",
  }));
  const mapped = Object.keys(map).length;
  const note = setup ? SETUP_NOTE[setup] : undefined;
  const label = FORM_LABEL[t.form_code as keyof typeof FORM_LABEL] ?? t.form_code;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/tax-templates" className="text-[13px] text-mute hover:underline">← All templates</Link>
        <h1 className="mt-2 text-[20px] font-bold tracking-tight text-ink">
          {label} · {t.tax_year}
          {kind === "link_only" ? <span className="ml-2 align-middle rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] font-normal text-mute">Link only — rules, no PDF</span> : null}
        </h1>
        <p className="mt-1 text-[12px] text-mute">
          From <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t.source_url}</a>
          {t.instructions_url ? (
            <>
              {" "}· instructions <a href={t.instructions_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t.instructions_url}</a>
            </>
          ) : null}
          {kind === "pdf" ? (
            <>
              {" "}· fetched {String(t.fetched_at).slice(0, 10)} · SHA-256 <span className="font-mono">{String(t.sha256).slice(0, 16)}…</span>
              {t.revision_title ? ` · titled “${t.revision_title}”` : " · no title in the PDF"} · {fields.length} AcroForm fields, {mapped} mapped
            </>
          ) : (
            <> · added {String(t.created_at).slice(0, 10)}</>
          )}
          {t.verified_at ? ` · verified ${String(t.verified_at).slice(0, 10)}` : " · not verified"}
          {t.suggested_from ? ` · from Walkup's suggestion ${t.suggested_from}` : ""}
        </p>
        {t.notes ? <p className="mt-2 text-[13px] text-mute">{t.notes}</p> : null}
      </div>

      {note ? <p className={`rounded-lg border px-4 py-3 text-[13px] ${NOTE_TONE[note.tone]}`}>{note.text}</p> : null}

      {kind === "pdf" ? (
        <Card
          title="Check it"
          hint="The labeled preview prints every text field's own name in its box; the sample export fills every mapped box with its label (money lines 1234.56, checkboxes ticked), mirrors and keeps the pages exactly as a board's export would."
        >
          <div className="flex flex-wrap gap-2">
            <a href={`/admin/tax-templates/${t.id}/preview`} target="_blank" rel="noopener noreferrer" className={linkBtn}>
              Open the labeled preview
            </a>
            <a href={`/admin/tax-templates/${t.id}/preview?sample=1`} target="_blank" rel="noopener noreferrer" className={linkBtn}>
              Open the filled sample export
            </a>
            <a href={`/admin/tax-templates/${t.id}/preview?blank=1`} target="_blank" rel="noopener noreferrer" className={linkBtn}>
              Open the stored official PDF
            </a>
          </div>
          <div className="mt-4">
            <ActivationControls id={t.id} active={t.active} kind={kind} />
          </div>
        </Card>
      ) : (
        <Card title="Check it" hint="There is no PDF to preview. Open the official page and read the due rule, the filing instructions and the citations against it.">
          <div className="flex flex-wrap gap-2">
            <a href={t.source_url} target="_blank" rel="noopener noreferrer" className={linkBtn}>
              Open the official page ↗
            </a>
            {t.instructions_url ? (
              <a href={t.instructions_url} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                Open the instructions ↗
              </a>
            ) : null}
          </div>
          <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-[10rem_1fr]">
            <dt className="text-mute">Due rule</dt>
            <dd>
              {t.due_rule ? <span className="font-mono">{t.due_rule}</span> : <span className="text-mute">none — boards read “ask your CPA”</span>}
              {t.due_rule_citation ? <span className="block text-[12px] text-mute">{t.due_rule_citation}</span> : null}
            </dd>
            <dt className="text-mute">Filing instructions</dt>
            <dd>
              {t.filing_instructions ?? <span className="text-mute">none</span>}
              {t.filing_citation ? <span className="block text-[12px] text-mute">{t.filing_citation}</span> : null}
            </dd>
          </dl>
          <div className="mt-4">
            <ActivationControls id={t.id} active={t.active} kind={kind} />
          </div>
        </Card>
      )}

      <Card title={kind === "pdf" ? "Map and rules" : "Rules"}>
        <FieldMapForm
          id={t.id}
          kind={kind}
          rows={mapRows}
          locked={t.active}
          meta={{
            dueRule: t.due_rule ?? "",
            dueCitation: t.due_rule_citation ?? "",
            instructions: t.filing_instructions ?? "",
            filingCitation: t.filing_citation ?? "",
            instructionsUrl: t.instructions_url ?? "",
            notes: t.notes ?? "",
            revision: t.revision ?? "",
            includePages: includePagesText(Array.isArray(t.include_pages) ? (t.include_pages as unknown[]).map(Number) : null),
            mirror: mirrorText(Array.isArray(t.mirror_json) ? (t.mirror_json as { from: string; to: string }[]) : []),
          }}
          keys={{ setting: SETTING_KEYS, ledger: LEDGER_KEYS, contractors: CONTRACTOR_KEYS }}
        />
      </Card>
    </div>
  );
}
