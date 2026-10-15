import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { longDate } from "@/lib/dates";
import { COVERAGE_TYPES, coverageLabel, type SectionKey } from "@/lib/insurance/coverage";
import { FIELD_BY_KEY, rowText } from "@/lib/insurance/fields";
import { formatPhone, periodLabel } from "@/lib/insurance/format";
import { loadInsuranceContext, loadPolicies, type PolicyWithStatus } from "@/lib/insurance/queries";
import { displayValue, effectiveSections } from "@/lib/insurance/status";
import { BackLink } from "../components/page-header";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * The insurance facts sheet (insurance-spec §9.12): a print-first one-pager
 * of every policy in force, for a lender, a buyer's attorney or the next
 * board. Unrecorded items are left out rather than shown blank.
 */

/** What the sheet lists per policy, with labels that stand alone outside their section. */
const SHEET_FIELDS: { key: string; label: string }[] = [
  { key: "building_limit", label: "Building limit" },
  { key: "liability_per_occurrence", label: "Liability, each occurrence" },
  { key: "liability_aggregate", label: "Liability, aggregate" },
  { key: "do_limit", label: "D&O limit" },
  { key: "crime_limit", label: "Crime limit (employee theft)" },
  { key: "umbrella_limit", label: "Umbrella limit" },
  { key: "flood_building_limit", label: "Flood, building" },
  { key: "flood_contents_limit", label: "Flood, contents" },
  { key: "earthquake_limit", label: "Earthquake limit" },
  { key: "equipment_breakdown_limit", label: "Equipment breakdown limit" },
  { key: "wc_el_each_accident", label: "Employers' liability, each accident" },
  { key: "cyber_limit", label: "Cyber limit" },
  { key: "epli_limit", label: "Employment practices limit" },
  { key: "generic_limit", label: "Limit" },
  { key: "property_deductible", label: "Deductible, all other perils" },
  { key: "water_damage_deductible", label: "Deductible, water damage" },
  { key: "wind_hail_deductible_percent", label: "Deductible, wind or hail" },
  { key: "wind_hail_deductible", label: "Deductible, wind or hail (dollars or minimum)" },
  { key: "per_unit_deductible", label: "Deductible, per unit" },
  { key: "do_retention", label: "D&O retention" },
  { key: "crime_deductible", label: "Crime deductible" },
  { key: "umbrella_retention", label: "Umbrella retention" },
  { key: "flood_deductible", label: "Flood deductible" },
  { key: "earthquake_deductible_percent", label: "Earthquake deductible" },
  { key: "earthquake_deductible", label: "Earthquake deductible (dollars or minimum)" },
  { key: "equipment_breakdown_deductible", label: "Equipment breakdown deductible" },
  { key: "cyber_retention", label: "Cyber retention" },
  { key: "epli_retention", label: "Employment practices retention" },
  { key: "generic_deductible", label: "Deductible" },
  { key: "coverage_form", label: "What's covered inside units" },
];

const PRINT_CSS = `
@media print {
  nav[aria-label="Main"], .app-shell > header, .app-shell > footer { display: none !important; }
  .app-shell { padding-left: 0 !important; }
  main { max-width: none !important; padding: 0 !important; }
  body { background: #fff !important; color: #000 !important; }
  .insurance-sheet { font-size: 11pt; color: #000; }
  .insurance-sheet section { break-inside: avoid; }
}`;

type Agent = { name: string; person: string | null; phone: string | null; email: string | null };

function rows(p: PolicyWithStatus, agent: Agent | null): { label: string; value: string }[] {
  const sections = new Set<SectionKey>(effectiveSections(p));
  const out: { label: string; value: string }[] = [];
  const number = rowText(p, "policy_number");
  if (number) out.push({ label: "Policy number", value: number });
  out.push({ label: "Period", value: periodLabel(p.effective_from, p.effective_to) });
  for (const f of SHEET_FIELDS) {
    const def = FIELD_BY_KEY.get(f.key);
    if (!def || !sections.has(def.group as SectionKey)) continue;
    const v = displayValue(def, p);
    if (v !== null && !(f.key === "coverage_form" && rowText(p, "coverage_form") === "unknown")) out.push({ label: f.label, value: v });
  }
  const claims = rowText(p, "claims_phone");
  if (claims) out.push({ label: "Claims phone", value: formatPhone(claims) ?? claims });
  if (agent) {
    out.push({
      label: "Agent",
      value: [agent.person ? `${agent.person}, ${agent.name}` : agent.name, agent.phone ? (formatPhone(agent.phone) ?? agent.phone) : null, agent.email]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return out;
}

export default async function InsuranceSheetPage() {
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.canRead) notFound();
  const a = ctx.association;
  const policies = await loadPolicies(supabase, a.id, ctx.todayIso);
  const order = COVERAGE_TYPES.map((c) => c.value as string);
  const inForce = policies
    .filter((p) => p.status === "active")
    .sort((x, y) => order.indexOf(x.coverage) - order.indexOf(y.coverage) || x.effective_from.localeCompare(y.effective_from));

  const agentIds = [...new Set(inForce.map((p) => rowText(p, "agent_contact_id")).filter((x): x is string => !!x))];
  const { data: contactRows } = agentIds.length
    ? await supabase.from("insurance_contacts").select("id, name, person_name, phone, email").in("id", agentIds)
    : { data: [] };
  const contacts = new Map(((contactRows ?? []) as { id: string; name: string; person_name: string | null; phone: string | null; email: string | null }[]).map((c) => [c.id, c]));
  const agentFor = (p: PolicyWithStatus): Agent | null => {
    const c = contacts.get(rowText(p, "agent_contact_id") ?? "");
    if (c) return { name: c.name, person: c.person_name, phone: c.phone, email: c.email };
    const agency = rowText(p, "agency_name");
    const broker = rowText(p, "broker_name");
    if (!agency && !broker) return null;
    return { name: (agency ?? broker) as string, person: agency ? broker : null, phone: rowText(p, "agent_phone"), email: rowText(p, "broker_email") };
  };

  const name = a.legal_name?.trim() || a.display_name?.trim() || "The association";
  const address = [a.street_address?.trim(), a.city?.trim(), [a.state_code?.trim(), a.postal_code?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <div className="insurance-sheet mx-auto max-w-3xl space-y-6">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href="/insurance">Insurance</BackLink>
        <PrintButton />
      </div>

      <header className="border-b border-ink pb-3">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{name}: insurance facts</h1>
        <p className="mt-1 text-[13px] text-ink">
          {[address || null, `${ctx.unitCount} ${ctx.unitCount === 1 ? "unit" : "units"}`].filter(Boolean).join(" · ")}
        </p>
      </header>

      {inForce.length === 0 ? (
        <p className="text-[13px] text-ink">No policies in force are recorded.</p>
      ) : (
        inForce.map((p) => (
          <section key={p.id} aria-label={coverageLabel(p.coverage)} className="space-y-2">
            <h2 className="text-[15px] font-bold text-ink">
              {coverageLabel(p.coverage)}: {p.carrier_name}
            </h2>
            <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2 print:grid-cols-2">
              {rows(p, agentFor(p)).map((r) => (
                <div key={r.label} className="flex justify-between gap-3 border-b border-line py-1 print:border-black/20">
                  <dt className="text-mute print:text-black">{r.label}</dt>
                  <dd className="figures text-right text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}

      <footer className="border-t border-ink pt-3 text-[12px] text-ink">
        Prepared from {name}&rsquo;s records in Walkup on {longDate(ctx.todayIso)}. This is a summary, not the policies. The agent can confirm
        details and issue certificates.
      </footer>
    </div>
  );
}
