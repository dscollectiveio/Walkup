import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { FORM_LABEL } from "@/lib/tax/determine";
import { CheckUpdatesButton, FetchTemplateForm } from "./template-client";

export const dynamic = "force-dynamic";

/**
 * Platform admin only (DECISIONS #31). Official forms, fetched from the IRS
 * and Illinois, mapped and verified by a person before anything fills from
 * them. Ships with none.
 */
export default async function TaxTemplatesPage() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return <Restricted what="platform settings" />;

  const { data: templates } = await supabase
    .from("tax_form_templates")
    .select("id, form_code, tax_year, revision, source_url, active, verified_at, fetched_at, notes, field_map_json, field_names_json")
    .order("tax_year", { ascending: false })
    .order("form_code");
  const january = new Date().getMonth() === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Official tax form templates</h1>
        <p className="mt-1 text-mute">
          Walkup fills only these PDFs, and only after a person has checked the field map against the printed form and
          activated it. Boards never see this page.
        </p>
      </div>

      {january ? (
        <p className="rounded-lg border border-warning-line bg-warning-tint px-4 py-3 text-[13px] text-warning-text">
          It&rsquo;s January — the IRS and Illinois often republish forms now. Check the active templates for updates.
        </p>
      ) : null}

      <Card title="Templates">
        {(templates ?? []).length === 0 ? (
          <Empty>No templates yet.</Empty>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {(templates ?? []).map((t) => {
              const mapped = Object.keys(t.field_map_json ?? {}).length;
              const total = (t.field_names_json ?? []).length;
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link href={`/admin/tax-templates/${t.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                    {FORM_LABEL[t.form_code as keyof typeof FORM_LABEL] ?? t.form_code} · {t.tax_year}
                    {t.revision ? ` · ${t.revision}` : ""}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2 text-[12px] text-mute">
                    {mapped} of {total} fields mapped
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

      <Card title="Fetch a form" hint="From irs.gov, tax.illinois.gov or ilsos.gov only. It's stored, checksummed, and its fields listed — inactive until verified.">
        <FetchTemplateForm />
      </Card>
    </div>
  );
}
