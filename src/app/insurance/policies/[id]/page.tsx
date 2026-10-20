import Link from "next/link";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty } from "@/components/ui";
import { EntityDocuments } from "@/app/documents/entity-documents";
import { listLinkedDocuments } from "@/lib/documents/access";
import { SECTION_LABEL, coverageLabel, isCoverageType } from "@/lib/insurance/coverage";
import { PAYMENT_SCHEDULES, fieldsFor, optionLabel, rowText, type FieldDef } from "@/lib/insurance/fields";
import { bp4OrNull, centsOrNull, formatMoney, formatPhone, longDate, mulCentsBp4, periodLabel, telHref } from "@/lib/insurance/format";
import { switchingChecklist, type ChecklistItem } from "@/lib/insurance/emails";
import { loadInsuranceContext, loadPolicy, type Supabase } from "@/lib/insurance/queries";
import { displayValue, effectiveSections } from "@/lib/insurance/status";
import { fromCents } from "@/lib/money/cents";
import { ClaimsPanel, type ClaimRow } from "../../claims-panel";
import { ContactCard, type ContactCardContact } from "../../components/contact-card";
import { DesktopOpenDetails } from "../../components/desktop-open-details";
import { BackLink } from "../../components/page-header";
import { Provenance, type ProvenanceInfo } from "../../components/provenance";
import { StatusChip } from "../../components/status-chip";
import { Toast } from "../../components/toast";
import { YEAR_SELECT, YearByYear, type YearRow } from "../../components/year-by-year";
import { addDays } from "../../quote-helpers";
import { storedProvenance } from "../../review-data";
import { TrackPremium } from "../../track-premium";
import { btnSecondary } from "@/components/repairs/styles";
import { MoreMenu } from "./more-menu";
import { SummaryCard } from "./summary-card";
import { IssuedDeclarationsBanner, SwitchingChecklist } from "./switching";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The headline figures per section (§9.4 item 3); everything else is under "All details". */
const KEY_FIGURES: Record<string, string[]> = {
  property: ["building_limit", "coverage_form", "valuation"],
  property_deductibles: ["property_deductible", "water_damage_deductible", "wind_hail_deductible", "wind_hail_deductible_percent", "per_unit_deductible"],
  liability: ["liability_per_occurrence", "liability_aggregate"],
  do: ["do_limit", "do_retention"],
  crime: ["crime_limit", "crime_deductible"],
  umbrella: ["umbrella_limit"],
  flood: ["flood_building_limit", "flood_deductible"],
  earthquake: ["earthquake_limit", "earthquake_deductible_percent", "earthquake_deductible"],
  equipment: ["equipment_breakdown_limit", "equipment_breakdown_deductible"],
  workers_comp: ["wc_el_each_accident"],
  cyber: ["cyber_limit", "cyber_retention"],
  epli: ["epli_limit", "epli_retention"],
  generic: ["generic_limit", "generic_deductible"],
};

/** What a percent deductible is a percent of. */
const PERCENT_BASE: Record<string, string> = {
  wind_hail_deductible_percent: "building_limit",
  earthquake_deductible_percent: "earthquake_limit",
};

const FREQUENCY_WORDS: Record<string, string> = {
  annual: "once a year",
  semiannual: "twice a year",
  quarterly: "every quarter",
  monthly: "every month",
};

function tileValue(def: FieldDef, row: Record<string, unknown>): string | null {
  const shown = displayValue(def, row);
  if (shown === null || def.kind !== "percent" || !PERCENT_BASE[def.key]) return shown;
  const base = centsOrNull(rowText(row, PERCENT_BASE[def.key]));
  const bp4 = bp4OrNull(rowText(row, def.column));
  if (base === null || bp4 === null) return shown;
  return `${shown} (about ${formatMoney(fromCents(mulCentsBp4(base, bp4)))})`;
}

/**
 * §9.10a: the switching checklist for a policy started from a chosen quote,
 * while it is upcoming or in its first 30 days. Empty otherwise.
 */
async function switchingItems(
  supabase: Supabase,
  policy: { id: string; coverage: string; carrier_name: string; effective_from: string; status: string; agentContactId: string | null; acceptedQuoteId: string },
  oldPolicyId: string | null,
  hasPremiumBill: boolean,
  todayIso: string,
): Promise<ChecklistItem[]> {
  const inWindow = policy.status === "upcoming" || (policy.status === "active" && todayIso <= addDays(policy.effective_from, 30));
  if (!inWindow) return [];
  const [accepted, others, old, summary] = await Promise.all([
    supabase.from("insurance_quotes").select("id, contact_id").eq("id", policy.acceptedQuoteId).maybeSingle(),
    supabase
      .from("insurance_quotes")
      .select("id, contact_id, quoted_on")
      .eq("coverage", policy.coverage)
      .eq("was_selected", false)
      .neq("id", policy.acceptedQuoteId)
      .gte("quoted_on", addDays(policy.effective_from, -180)),
    oldPolicyId
      ? supabase.from("insurance_policies").select("id, carrier_name, agent_contact_id").eq("id", oldPolicyId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("insurance_owner_summaries").select("published_at").maybeSingle(),
  ]);
  const acceptedRow = accepted.data as { id: string; contact_id: string | null } | null;
  const otherRows = (others.data ?? []) as { id: string; contact_id: string | null }[];
  const oldRow = old.data as { id: string; carrier_name: string; agent_contact_id: string | null } | null;
  const newContactId = policy.agentContactId ?? acceptedRow?.contact_id ?? null;
  const ids = [...new Set([newContactId, oldRow?.agent_contact_id, ...otherRows.map((q) => q.contact_id)].filter((x): x is string => !!x))];
  const { data: contactRows } = ids.length
    ? await supabase.from("insurance_contacts").select("id, name").in("id", ids)
    : { data: [] as { id: string; name: string }[] };
  const name = new Map(((contactRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const contact = (id: string | null | undefined) => (id && name.has(id) ? { id, name: name.get(id) as string } : null);
  return switchingChecklist({
    newPolicy: { id: policy.id, carrier: policy.carrier_name, effectiveFrom: policy.effective_from, contact: contact(newContactId) },
    oldPolicy: oldRow
      ? { id: oldRow.id, carrier: oldRow.carrier_name, contact: contact(oldRow.agent_contact_id), sameAgency: !!oldRow.agent_contact_id && oldRow.agent_contact_id === newContactId }
      : null,
    otherQuotes: otherRows.map((q) => ({ quoteId: q.id, contactId: q.contact_id, contactName: contact(q.contact_id)?.name ?? null })),
    hasPremiumBill,
    ownerSummaryPublished: Boolean((summary.data as { published_at: string | null } | null)?.published_at),
  });
}

/** /insurance/policies/[id] (§9.4). */
export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.canRead) notFound();
  const policy = await loadPolicy(supabase, id, ctx.todayIso);
  if (!policy) notFound();
  const assoc = ctx.association.id;
  const canEdit = ctx.isBoard;
  const aiOn = aiConfigured();

  const agentId = rowText(policy, "agent_contact_id");
  const [prov, contact, claimsRes, tickets, accounts, bill, history, replaces, documents] = await Promise.all([
    storedProvenance(supabase, { policyId: id }),
    agentId
      ? supabase.from("insurance_contacts").select("id, name, person_name, kind, email, phone, website_url").eq("id", agentId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("insurance_claims")
      .select(
        "id, policy_id, date_of_loss, reported_on, claim_number, description, amount_claimed::text, amount_paid::text, deductible_applied::text, status, closed_on, adjuster_name, adjuster_email, adjuster_phone, notes, tickets(id, reference, title)",
      )
      .eq("policy_id", id)
      .order("date_of_loss", { ascending: false }),
    canEdit
      ? supabase.from("tickets").select("id, reference, title").eq("association_id", assoc).order("opened_on", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
    canEdit
      ? supabase.from("accounts").select("id, name").eq("association_id", assoc).eq("type", "expense").eq("is_active", true).order("code")
      : Promise.resolve({ data: [] }),
    supabase
      .from("recurring_bills")
      .select("id, frequency, typical_amount::text, next_due_on, is_active, account_id")
      .eq("insurance_policy_id", id)
      .order("is_active", { ascending: false })
      .limit(1),
    supabase.from("insurance_year_over_year").select(YEAR_SELECT).eq("association_id", assoc).eq("coverage", policy.coverage).order("effective_from", { ascending: false }),
    supabase.from("insurance_policies").select("id, carrier_name, effective_from").eq("replaced_by_policy_id", id),
    listLinkedDocuments(supabase, "insurance_policies", id),
  ]);

  const claimRows = ((claimsRes.data ?? []) as unknown as (Omit<ClaimRow, "ticket"> & { tickets: ClaimRow["ticket"] | ClaimRow["ticket"][] })[]).map(
    (c) => ({ ...c, ticket: Array.isArray(c.tickets) ? c.tickets[0] ?? null : c.tickets ?? null }) as ClaimRow,
  );
  const claimDocs = await Promise.all(claimRows.map((c) => listLinkedDocuments(supabase, "insurance_claims", c.id)));
  const claimDocNodes: Record<string, React.ReactNode> = {};
  claimRows.forEach((c, i) => {
    claimDocNodes[c.id] = <EntityDocuments targetTable="insurance_claims" targetId={c.id} documents={claimDocs[i]} canWrite={canEdit} />;
  });

  const coverage = isCoverageType(policy.coverage) ? policy.coverage : "other";
  const sections = effectiveSections(policy);
  const defs = fieldsFor(coverage, sections, "policy");
  const documentId = rowText(policy, "source_document_id") ?? prov.documentId;
  const claimsPhone = rowText(policy, "claims_phone");
  const claimsTel = claimsPhone ? telHref(claimsPhone) : null;
  const number = rowText(policy, "policy_number");
  const successorId = policy.successor_id;
  const billRow = ((bill.data ?? []) as unknown as { frequency: string; typical_amount: string | null; next_due_on: string | null; is_active: boolean; account_id: string }[])[0] ?? null;
  const accountList = (accounts.data ?? []) as { id: string; name: string }[];

  // Key figures: claims line first, then the headline fields that hold a value.
  const tiles: { key: string; label: string; value: string; prov: ProvenanceInfo | null; tel?: string | null }[] = [];
  if (claimsPhone) {
    tiles.push({ key: "claims_phone", label: "Claims line", value: formatPhone(claimsPhone) ?? claimsPhone, prov: prov.byField.claims_phone ?? null, tel: claimsTel });
  }
  for (const s of sections) {
    for (const key of KEY_FIGURES[s] ?? []) {
      const def = defs.find((d) => d.key === key);
      if (!def) continue;
      const value = tileValue(def, policy);
      if (value === null) continue;
      tiles.push({ key, label: s === "property_deductibles" ? `${def.label} deductible` : def.label, value, prov: prov.byField[key] ?? null });
    }
  }

  const agent: ContactCardContact | null =
    (contact.data as ContactCardContact | null) ??
    (rowText(policy, "agency_name") || rowText(policy, "broker_name")
      ? {
          id: "",
          name: (rowText(policy, "agency_name") ?? rowText(policy, "broker_name")) as string,
          person_name: rowText(policy, "agency_name") ? rowText(policy, "broker_name") : null,
          kind: rowText(policy, "agency_name") ? "agency" : "agent",
          email: rowText(policy, "broker_email"),
          phone: rowText(policy, "agent_phone"),
        }
      : null);

  const lists = {
    endorsements: (Array.isArray(policy.endorsements) ? policy.endorsements : []) as { form_number: string | null; title: string; page: number | null }[],
    exclusions: (Array.isArray(policy.exclusions) ? policy.exclusions : []) as { title: string; page: number | null }[],
    premium: (Array.isArray(policy.premium_breakdown) ? policy.premium_breakdown : []) as { label: string; amount: string; page: number | null }[],
  };
  const summaryText = rowText(policy, "summary_text");
  const summarySource = (rowText(policy, "summary_source") as "model" | "board" | null) ?? null;
  const summaryError = rowText(policy, "summary_error");
  const writing = sp.saved === "1" && !summaryText && !summaryError && aiOn;
  const groups = ["basics", "agent", ...sections] as string[];
  const historyRows = (history.data ?? []) as unknown as YearRow[];
  const replacedRows = (replaces.data ?? []) as { id: string; carrier_name: string; effective_from: string }[];

  // §9.10a / §10.5: a policy started from a chosen quote.
  const acceptedQuoteId = rowText(policy, "accepted_quote_id");
  const switching =
    canEdit && acceptedQuoteId && policy.status !== "archived"
      ? await switchingItems(
          supabase,
          { ...policy, agentContactId: agentId, acceptedQuoteId },
          replacedRows[0]?.id ?? null,
          billRow !== null,
          ctx.todayIso,
        )
      : [];
  let quoteDocumentId: string | null = null;
  if (canEdit && acceptedQuoteId) {
    const { data: q } = await supabase.from("insurance_quotes").select("document_id").eq("id", acceptedQuoteId).maybeSingle();
    quoteDocumentId = (q as { document_id: string | null } | null)?.document_id ?? null;
  }
  const onlyQuoteDocument =
    canEdit && !!acceptedQuoteId && policy.status !== "archived" && documents.every((d) => d.id === quoteDocumentId);

  return (
    <div className="space-y-6">
      <BackLink href="/insurance?view=policies">Insurance</BackLink>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">{policy.carrier_name}</h1>
          <p className="mt-1 text-mute">
            {[coverageLabel(policy.coverage), number ? `Policy ${number}` : null, periodLabel(policy.effective_from, policy.effective_to)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-2">
            <StatusChip policy={policy} todayIso={ctx.todayIso} />
          </div>
        </div>
        {canEdit ? <MoreMenu policyId={id} isAdmin={ctx.isAdmin} archived={policy.status === "archived"} /> : null}
      </header>

      {onlyQuoteDocument ? <IssuedDeclarationsBanner policyId={id} aiOn={aiOn} /> : null}
      {switching.length > 0 ? <SwitchingChecklist policyId={id} items={switching} /> : null}

      <Card navy title="Summary">
        <SummaryCard
          policyId={id}
          text={summaryText}
          source={summarySource}
          error={summaryError}
          aiOn={aiOn}
          canEdit={canEdit}
          writing={writing}
        />
      </Card>

      {tiles.length > 0 ? (
        <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.key} className="rounded-xl border border-line bg-paper px-4 py-3">
              <div className="text-[11px] text-mute">{t.label}</div>
              <div className="figures mt-1 text-[18px] text-ink">
                {t.tel ? (
                  <a href={t.tel} className="underline underline-offset-2">
                    {t.value}
                  </a>
                ) : (
                  t.value
                )}
              </div>
              <Provenance info={t.prov} documentId={t.prov?.source === "extracted" ? documentId : null} variant="tile" />
            </div>
          ))}
        </section>
      ) : (
        <p className="text-[13px] text-mute">No limits or deductibles are recorded for this policy.</p>
      )}

      <div className="space-y-3">
        <h2 className="eyebrow text-mute">All details</h2>
        {groups.map((g) => {
          const gd = defs.filter((d) => d.group === g && d.key !== "policy_type");
          if (gd.length === 0) return null;
          return (
            <DesktopOpenDetails key={g} summary={SECTION_LABEL[g as keyof typeof SECTION_LABEL] ?? g}>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {gd.map((d) => {
                  const v = displayValue(d, policy);
                  return (
                    <div key={d.key} className="min-w-0">
                      <dt className="text-[11px] text-mute">{d.label}</dt>
                      <dd className={`text-[13px] ${v === null ? "text-mute-soft" : "figures text-ink"}`}>{v ?? "Not recorded"}</dd>
                      {v !== null ? (
                        <Provenance
                          info={prov.byField[d.key] ?? null}
                          documentId={prov.byField[d.key]?.source === "extracted" ? documentId : null}
                          variant="tile"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            </DesktopOpenDetails>
          );
        })}
      </div>

      {lists.endorsements.length > 0 ? (
        <Card navy title="Endorsements">
          <ul className="space-y-1 text-[13px] text-ink">
            {lists.endorsements.map((e, i) => (
              <li key={i}>
                {e.form_number ? <span className="figures text-mute">{e.form_number} </span> : null}
                {e.title}
                {e.page ? <span className="text-[11px] text-mute"> · page {e.page}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {lists.exclusions.length > 0 ? (
        <Card navy title="Exclusions">
          <ul className="space-y-1 text-[13px] text-ink">
            {lists.exclusions.map((e, i) => (
              <li key={i}>
                {e.title}
                {e.page ? <span className="text-[11px] text-mute"> · page {e.page}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {lists.premium.length > 0 ? (
        <Card navy title="Premium breakdown">
          <ul className="divide-y divide-line text-[13px]">
            {lists.premium.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span className="text-ink">{l.label}</span>
                <span className="figures text-ink">{formatMoney(l.amount, { cents: true })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card navy title="Premium and bill">
        <div className="space-y-3 text-[13px]">
          <div>
            <span className="figures text-[22px] text-ink">{formatMoney(policy.annual_premium)}</span>
            <span className="ml-2 text-mute">a year</span>
            {rowText(policy, "payment_schedule") && rowText(policy, "payment_schedule") !== "unknown" ? (
              <span className="ml-2 text-mute">· paid {optionLabel(PAYMENT_SCHEDULES, rowText(policy, "payment_schedule") as string).toLowerCase()}</span>
            ) : null}
          </div>
          {billRow?.is_active ? (
            <p className="text-ink">
              Tracked as a bill:{" "}
              <span className="figures">{billRow.typical_amount ? formatMoney(billRow.typical_amount, { cents: true }) : ""}</span>{" "}
              {FREQUENCY_WORDS[billRow.frequency] ?? billRow.frequency}
              {billRow.next_due_on ? `, next due ${longDate(billRow.next_due_on)}` : ""}.{" "}
              <Link href="/bills" className="underline underline-offset-2">
                See bills
              </Link>
            </p>
          ) : billRow && successorId ? (
            <p className="text-mute">Last bill paid. The renewal&rsquo;s bill takes over.</p>
          ) : canEdit && policy.status !== "archived" ? (
            <TrackPremium
              policyId={id}
              categories={accountList}
              defaultCategoryId={accountList.find((a) => /insurance/i.test(a.name))?.id ?? null}
            />
          ) : (
            <p className="text-mute">Not tracked as a bill.</p>
          )}
        </div>
      </Card>

      <Card navy title="Agent">
        {agent ? (
          <ContactCard contact={agent}>
            {canEdit && agent.id ? (
              <Link
                href={`/insurance/emails/new?kind=certificate_request&contact=${agent.id}`}
                className={btnSecondary}
              >
                Ask for a certificate
              </Link>
            ) : null}
          </ContactCard>
        ) : (
          <p className="text-[13px] text-mute">No agent recorded on this policy.</p>
        )}
      </Card>

      <Card navy title="Claims" hint="Anything filed against this policy.">
        <ClaimsPanel
          policyId={id}
          claims={claimRows}
          tickets={((tickets.data ?? []) as { id: string; reference: number; title: string }[]).map((t) => ({ id: t.id, label: `#${t.reference} ${t.title}` }))}
          canEdit={canEdit}
          isAdmin={ctx.isAdmin}
          claimsLine={claimsPhone ? { carrier: policy.carrier_name, phone: claimsPhone } : null}
          documents={claimDocNodes}
        />
      </Card>

      <Card navy title="Documents">
        <EntityDocuments targetTable="insurance_policies" targetId={id} documents={documents} canWrite={canEdit} />
      </Card>

      <Card navy title="History">
        <div className="space-y-3">
          {successorId ? (
            <p className="text-[13px]">
              Replaced by{" "}
              <Link href={`/insurance/policies/${successorId}`} className="underline underline-offset-2">
                the renewal
              </Link>
              .
            </p>
          ) : null}
          {replacedRows.map((r) => (
            <p key={r.id} className="text-[13px]">
              Replaces{" "}
              <Link href={`/insurance/policies/${r.id}`} className="underline underline-offset-2">
                {r.carrier_name}, from {longDate(r.effective_from)}
              </Link>
              .
            </p>
          ))}
          {historyRows.length > 0 ? (
            <YearByYear rows={historyRows} todayIso={ctx.todayIso} showCoverage={false} />
          ) : (
            <Empty>No earlier terms recorded.</Empty>
          )}
        </div>
      </Card>

      <Toast message={sp.saved === "1" ? "Policy saved." : null} />
    </div>
  );
}

