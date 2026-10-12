import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { FORM_LABEL } from "@/lib/tax/determine";
import { SUGGESTED } from "@/lib/tax/suggested";
import { LINK_FORM_CODES, effectiveWords, parameterLabel, parameterValueWords } from "./rules";
import { LinksPanel, type AdminLinkRow } from "./links-panel";
import { ParametersPanel, type ParameterRow } from "./parameters-panel";
import { SuggestedPanel, type SuggestionRow } from "./suggested-panel";
import { CheckUpdatesButton, FetchTemplateForm, LinkOnlyTemplateForm } from "./template-client";

export const dynamic = "force-dynamic";

/** The W-9 has links (boards ask contractors for one) but is never a template. */
const LINK_FORM_LABELS: Record<string, string> = { ...FORM_LABEL, irs_w9: "Form W-9" };

/**
 * Platform admin only (DECISIONS #31). Official forms, fetched from the IRS
 * and Illinois, mapped and verified by a person before anything fills from
 * them; the official links boards see, each checked by a person; and the
 * rates and thresholds Walkup computes with. Ships with no templates.
 */
export default async function TaxTemplatesPage() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return <Restricted what="platform settings" />;

  const [{ data: templates }, { data: links }, { data: parameters }] = await Promise.all([
    supabase
      .from("tax_form_templates")
      .select("id, form_code, tax_year, kind, revision, revision_title, source_url, active, verified_at, fetched_at, notes, suggested_from, field_map_json, field_names_json")
      .order("tax_year", { ascending: false })
      .order("form_code"),
    supabase
      .from("tax_form_links")
      .select("id, form_code, kind, label, url, state_code, retrieved_on, retrieved_note, verified_at, last_checked_at, last_check_status, active, sort_order")
      .order("form_code")
      .order("sort_order")
      .order("label"),
    supabase
      .from("tax_parameters")
      .select("id, key, numeric_value, effective_from, effective_to, source_url, verified_on, notes")
      .order("key")
      .order("effective_from"),
  ]);
  const january = new Date().getMonth() === 0;

  // Which suggestion became which template, by the key the install recorded.
  const installedBy = new Map<string, { id: string; active: boolean; verified: boolean; mapped: number }>();
  for (const t of templates ?? []) {
    if (!t.suggested_from || installedBy.has(t.suggested_from)) continue;
    installedBy.set(t.suggested_from, { id: t.id, active: t.active === true, verified: !!t.verified_at, mapped: Object.keys(t.field_map_json ?? {}).length });
  }
  const suggestions: SuggestionRow[] = SUGGESTED.map((s) => ({
    key: s.key,
    label: FORM_LABEL[s.formCode],
    taxYear: s.taxYear,
    kind: s.kind,
    revision: s.revision,
    sourceUrl: s.sourceUrl,
    notes: s.notes,
    authoredOn: s.authoredOn,
    installed: installedBy.get(s.key) ?? null,
  }));

  const parameterRows: ParameterRow[] = (parameters ?? []).map((p) => ({
    id: p.id,
    key: p.key,
    label: parameterLabel(p.key),
    valueWords: parameterValueWords(p.key, p.numeric_value),
    effectiveWords: effectiveWords(p.effective_from, p.effective_to ?? null),
    verifiedOn: p.verified_on ?? null,
    sourceUrl: p.source_url ?? null,
    notes: p.notes ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Official tax forms, links and rules</h1>
        <p className="mt-1 text-mute">
          Walkup fills only these PDFs, and only after a person has checked the field map against the printed form and
          activated it. The links and the rates below are what every board sees, each marked checked or not yet checked by a person.
          Boards never see this page.
        </p>
      </div>

      {january ? (
        <p className="rounded-lg border border-warning-line bg-warning-tint px-4 py-3 text-[13px] text-warning-text">
          It&rsquo;s January — the IRS and Illinois often republish forms now. Check the active templates for updates, and open each link again.
        </p>
      ) : null}

      <Card
        title="Set up from Walkup's suggestions"
        hint="Walkup's own cited field maps and rules for the official forms, authored 2026-10-11. Setting one up fetches the pinned PDF, applies the map only if the file is byte-for-byte the one it was written against, and leaves the template inactive — you still check it and activate it."
      >
        <SuggestedPanel rows={suggestions} />
      </Card>

      <Card title="Templates">
        {(templates ?? []).length === 0 ? (
          <Empty>No templates yet. Set one up from the suggestions above, or fetch a form below.</Empty>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {(templates ?? []).map((t) => {
              const linkOnly = t.kind === "link_only";
              const mapped = Object.keys(t.field_map_json ?? {}).length;
              const total = (t.field_names_json ?? []).length;
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link href={`/admin/tax-templates/${t.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                    {FORM_LABEL[t.form_code as keyof typeof FORM_LABEL] ?? t.form_code} · {t.tax_year}
                    {t.revision ? ` · ${t.revision}` : ""}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2 text-[12px] text-mute">
                    {linkOnly ? (
                      <span className="rounded-full border border-line bg-fill px-2 py-0.5 text-[11px]">Link only — rules, no PDF</span>
                    ) : (
                      <>
                        {mapped} of {total} fields mapped
                        {t.revision_title ? <span className="text-mute-soft">“{t.revision_title}”</span> : null}
                      </>
                    )}
                    {t.suggested_from ? <span className="text-mute-soft">from suggestion {t.suggested_from}</span> : null}
                    {t.active ? (
                      <span className="rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">Active</span>
                    ) : t.verified_at ? (
                      <span className="rounded-full border border-line bg-fill px-2 py-0.5 text-[11px]">Verified, inactive</span>
                    ) : (
                      <span className="rounded-full border border-warning-line bg-warning-tint px-2 py-0.5 text-[11px] text-warning-text">Not verified</span>
                    )}
                  </span>
                  {t.notes ? <p className="w-full text-[11px] text-mute-soft">{t.notes}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
          <CheckUpdatesButton />
        </div>
      </Card>

      <Card
        title="Official links"
        hint="What boards see beside each form. Every link says when Walkup retrieved it and whether a person has opened it since — “I opened this and it's current” is that check. Nothing here is verified by code."
      >
        <LinksPanel rows={(links ?? []) as AdminLinkRow[]} formLabels={LINK_FORM_LABELS} formOrder={[...LINK_FORM_CODES]} />
      </Card>

      <Card
        title="Rules and thresholds"
        hint="The rates and amounts Walkup computes with, each for a period and from a source. A changed rule is a new row in a migration, never an edit here; this page only records that a person checked a figure."
      >
        <ParametersPanel rows={parameterRows} />
      </Card>

      <Card title="Fetch a form" hint="From irs.gov, tax.illinois.gov or ilsos.gov only. It's stored, checksummed, and its fields listed — inactive until verified.">
        <FetchTemplateForm />
      </Card>

      <Card
        title="Add a link-only template"
        hint="For a form Walkup never fills (the Illinois annual report, IL-1120, Form 1096): a cited due rule and filing instructions, verified and activated like any template, so boards get a real date instead of “ask your CPA”."
      >
        <LinkOnlyTemplateForm />
      </Card>
    </div>
  );
}
