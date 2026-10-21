import "server-only";
import { COVERAGE_TYPES, LINE_COVERAGE, coverageShort, type CoverageType } from "@/lib/insurance/coverage";
import type { runCoverageCheck } from "@/lib/insurance/coverage-check";
import { constructionLabel } from "@/lib/insurance/facts";
import { rowText } from "@/lib/insurance/fields";
import { formatMoney } from "@/lib/insurance/format";
import {
  adminNames, fundsTotal, loadFacts, type InsuranceContext, type PolicyWithStatus, type Supabase,
} from "@/lib/insurance/queries";
import { addDays, roundUpTo10k } from "./quote-helpers";

/**
 * What the Quotes & emails tab, the request flow and the Marketplace load
 * (insurance-spec §9.6, §9.7). Server only, under the caller's RLS; money
 * as text.
 */

type Check = ReturnType<typeof runCoverageCheck>;

export interface ContactRow {
  id: string;
  name: string;
  person_name: string | null;
  kind: string;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  city: string | null;
  state_code: string | null;
  lines: string[];
  source: string;
  source_urls: string[];
  found_key: string | null;
  found_at: string | null;
  partner_id: string | null;
  is_current_agent: boolean;
  notes: string | null;
  archived_at: string | null;
}

export const CONTACT_SELECT =
  "id, name, person_name, kind, email, phone, website_url, city, state_code, lines, source, source_urls, found_key, found_at, partner_id, is_current_agent, notes, archived_at";

/** Saved contacts (not archived), current agent first, then by name. */
export async function loadContacts(supabase: Supabase, associationId: string): Promise<ContactRow[]> {
  const { data } = await supabase
    .from("insurance_contacts")
    .select(CONTACT_SELECT)
    .eq("association_id", associationId)
    .is("archived_at", null)
    .order("is_current_agent", { ascending: false })
    .order("name");
  return (data ?? []) as unknown as ContactRow[];
}

export interface RequestRow {
  id: string;
  contact_id: string | null;
  partner_id: string | null;
  coverages: string[];
  status: string;
  sent_at: string | null;
  follow_up_on: string | null;
  declined_reason: string | null;
  created_at: string;
  contactName: string;
  /** The request's unsent draft email, for "Open draft". */
  draftMessageId: string | null;
  /** A quote saved against this request, for "See the quote". */
  quoteId: string | null;
}

export interface QuoteListRow {
  id: string;
  coverage: string;
  carrier_name: string;
  annual_premium: string;
  quoted_on: string;
  valid_until: string | null;
  declined_at: string | null;
  was_selected: boolean;
  contact_id: string | null;
  quote_request_id: string | null;
  document_id: string | null;
  contactName: string | null;
}

export interface MessageRow {
  id: string;
  kind: string;
  contact_id: string | null;
  contactName: string | null;
  to_email: string | null;
  subject: string;
  body: string;
  status: string;
  drafted_by: string;
  sent_at: string | null;
  created_at: string;
  quote_request_id: string | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadRequests(supabase: Supabase, associationId: string, filter?: { contactId?: string }): Promise<RequestRow[]> {
  let q = supabase
    .from("insurance_quote_requests")
    .select("id, contact_id, partner_id, coverages, status, sent_at, follow_up_on, declined_reason, created_at, insurance_contacts(name), insurance_partners(name)")
    .eq("association_id", associationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter?.contactId) q = q.eq("contact_id", filter.contactId);
  const { data } = await q;
  type Raw = Omit<RequestRow, "contactName" | "draftMessageId" | "quoteId"> & {
    insurance_contacts: { name: string } | { name: string }[] | null;
    insurance_partners: { name: string } | { name: string }[] | null;
  };
  const rows = (data ?? []) as unknown as Raw[];
  const ids = rows.map((r) => r.id);
  const [drafts, quotes] = ids.length
    ? await Promise.all([
        supabase.from("insurance_messages").select("id, quote_request_id").in("quote_request_id", ids).eq("status", "draft"),
        supabase.from("insurance_quotes").select("id, quote_request_id").in("quote_request_id", ids).order("quoted_on", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];
  const draftBy = new Map<string, string>();
  for (const m of (drafts.data ?? []) as { id: string; quote_request_id: string }[]) if (!draftBy.has(m.quote_request_id)) draftBy.set(m.quote_request_id, m.id);
  const quoteBy = new Map<string, string>();
  for (const x of (quotes.data ?? []) as { id: string; quote_request_id: string }[]) if (!quoteBy.has(x.quote_request_id)) quoteBy.set(x.quote_request_id, x.id);
  return rows.map((r) => ({
    id: r.id,
    contact_id: r.contact_id,
    partner_id: r.partner_id,
    coverages: r.coverages ?? [],
    status: r.status,
    sent_at: r.sent_at,
    follow_up_on: r.follow_up_on,
    declined_reason: r.declined_reason,
    created_at: r.created_at,
    contactName: one(r.insurance_contacts)?.name ?? one(r.insurance_partners)?.name ?? "A contact",
    draftMessageId: draftBy.get(r.id) ?? null,
    quoteId: quoteBy.get(r.id) ?? null,
  }));
}

export async function loadQuoteList(supabase: Supabase, associationId: string, filter?: { contactId?: string; coverage?: string }): Promise<QuoteListRow[]> {
  let q = supabase
    .from("insurance_quotes")
    .select("id, coverage, carrier_name, annual_premium::text, quoted_on, valid_until, declined_at, was_selected, contact_id, quote_request_id, document_id, insurance_contacts(name)")
    .eq("association_id", associationId)
    .order("quoted_on", { ascending: false })
    .limit(200);
  if (filter?.contactId) q = q.eq("contact_id", filter.contactId);
  if (filter?.coverage) q = q.eq("coverage", filter.coverage);
  const { data } = await q;
  type Raw = Omit<QuoteListRow, "contactName"> & { insurance_contacts: { name: string } | { name: string }[] | null };
  return ((data ?? []) as unknown as Raw[]).map(({ insurance_contacts, ...r }) => ({ ...r, contactName: one(insurance_contacts)?.name ?? null }));
}

export async function loadMessages(supabase: Supabase, associationId: string, filter?: { contactId?: string }): Promise<MessageRow[]> {
  let q = supabase
    .from("insurance_messages")
    .select("id, kind, contact_id, to_email, subject, body, status, drafted_by, sent_at, created_at, quote_request_id, insurance_contacts(name)")
    .eq("association_id", associationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter?.contactId) q = q.eq("contact_id", filter.contactId);
  const { data } = await q;
  type Raw = Omit<MessageRow, "contactName"> & { insurance_contacts: { name: string } | { name: string }[] | null };
  return ((data ?? []) as unknown as Raw[]).map(({ insurance_contacts, ...r }) => ({ ...r, contactName: one(insurance_contacts)?.name ?? null }));
}

/** In-force policy per coverage (latest start wins). */
export function inForceByCoverage(policies: PolicyWithStatus[]): Map<string, PolicyWithStatus> {
  const out = new Map<string, PolicyWithStatus>();
  for (const p of policies.filter((x) => x.status === "active").sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    out.set(p.coverage, p);
  }
  return out;
}

/**
 * The coverages a request would go out for (§9.6 item 2): lines in force,
 * plus lines from open gap and ask findings ("from Coverage check").
 */
export function requestCoverages(policies: PolicyWithStatus[], check: Check): { coverage: CoverageType; fromCheck: boolean }[] {
  const inForce = new Set(policies.filter((p) => p.status === "active").map((p) => p.coverage));
  const fromCheck = new Set<string>();
  for (const f of check.findings) {
    if (f.dismissed || !f.line || (f.severity !== "gap" && f.severity !== "ask")) continue;
    const c = LINE_COVERAGE[f.line];
    if (!inForce.has(c)) fromCheck.add(c);
  }
  return COVERAGE_TYPES.filter((c) => inForce.has(c.value) || fromCheck.has(c.value)).map((c) => ({
    coverage: c.value,
    fromCheck: fromCheck.has(c.value),
  }));
}

// ---------------------------------------------------------------------------
// The request flow (§9.7.2)

export interface WantedInput {
  key: string;
  label: string;
  kind: "money" | "enum";
  value: string;          // money text ("2400000.00") or the enum value; "" when unknown
  caption: string | null; // "From your current policy" / "From your bank balances"
  note?: string | null;
}

export interface RequestFlowData {
  contacts: { id: string; name: string; kind: string; email: string | null; isCurrentAgent: boolean }[];
  coverages: { coverage: CoverageType; label: string; preselected: boolean; fromCheck: boolean; wanted: WantedInput[] }[];
  deductiblesToday: { property: string | null; water: string | null; wind_hail: string | null; wind_hail_percent: string | null } | null;
  current: Record<string, { carrier: string; renews_on: string; premium: string }>;
  association: {
    legal_name: string; address: string; city: string | null; units: number; year_built: number | null; construction: string | null;
    stories: number | null; roof_replaced_year: number | null; total_square_feet: number | null; has_sprinklers: boolean | null;
    has_amenities: boolean | null; rental_share: string | null;
  };
  addressMissing: boolean;
  isAdmin: boolean;
  adminNames: string;
  claims: { date_of_loss: string; description: string; status: string; amount_paid: string | null }[];
  replyTo: { name: string; email: string; phone: string };
}

/** The main limit per coverage, for "others: limit". */
const MAIN_LIMIT: Partial<Record<CoverageType, { key: string; label: string }>> = {
  directors_officers: { key: "do_limit", label: "D&O limit" },
  umbrella: { key: "umbrella_limit", label: "Umbrella limit" },
  flood: { key: "flood_building_limit", label: "Flood building limit" },
  earthquake: { key: "earthquake_limit", label: "Earthquake limit" },
  equipment_breakdown: { key: "equipment_breakdown_limit", label: "Equipment breakdown limit" },
  workers_comp: { key: "wc_el_each_accident", label: "Employer's liability, each accident" },
  cyber: { key: "cyber_limit", label: "Cyber limit" },
  employment_practices: { key: "epli_limit", label: "Employment practices limit" },
  other: { key: "generic_limit", label: "Limit" },
};

const FROM_POLICY = "From your current policy";

function wantedFor(coverage: CoverageType, p: PolicyWithStatus | null, funds: { text: string; shown: string } | null, illinois: boolean): WantedInput[] {
  const money = (key: string, label: string): WantedInput => {
    const v = p ? rowText(p, key) : null;
    return { key, label, kind: "money", value: v ?? "", caption: v ? FROM_POLICY : null };
  };
  const enumOf = (key: string, label: string): WantedInput => {
    const v = p ? rowText(p, key) : null;
    const known = v && v !== "unknown" ? v : null;
    return { key, label, kind: "enum", value: known ?? "", caption: known ? FROM_POLICY : null };
  };
  switch (coverage) {
    case "property":
      return [
        money("building_limit", "Building limit"),
        enumOf("valuation", "Valuation"),
        enumOf("coverage_form", "Coverage form"),
        money("property_deductible", "All-perils deductible"),
        money("water_damage_deductible", "Water damage deductible"),
      ];
    case "general_liability":
      return [money("liability_per_occurrence", "Per occurrence")];
    case "fidelity_crime": {
      const rounded = funds ? roundUpTo10k(funds.text) : null;
      if (funds && rounded) {
        return [{
          key: "crime_limit", label: "Crime limit", kind: "money", value: rounded, caption: "From your bank balances",
          note: illinois ? `Your funds total ${funds.shown}. The Act asks for the full amount.` : `Your funds total ${funds.shown}.`,
        }];
      }
      return [money("crime_limit", "Crime limit")];
    }
    default: {
      const m = MAIN_LIMIT[coverage];
      return m ? [money(m.key, m.label)] : [];
    }
  }
}

export async function loadRequestFlow(
  supabase: Supabase,
  ctx: InsuranceContext,
  policies: PolicyWithStatus[],
  check: Check,
): Promise<RequestFlowData> {
  const assoc = ctx.association;
  const since = addDays(ctx.todayIso, -5 * 365);
  const [contacts, facts, funds, admins, claims, personId] = await Promise.all([
    loadContacts(supabase, assoc.id),
    loadFacts(supabase, assoc.id),
    fundsTotal(supabase, assoc.id),
    adminNames(supabase, assoc.id),
    supabase
      .from("insurance_claims")
      .select("date_of_loss, description, status, amount_paid::text")
      .eq("association_id", assoc.id)
      .gte("date_of_loss", since)
      .order("date_of_loss", { ascending: false })
      .limit(20),
    supabase.rpc("current_person_id", { assoc: assoc.id }),
  ]);
  let replyTo = { name: "", email: "", phone: "" };
  if (typeof personId.data === "string") {
    const [{ data }, { data: contact }] = await Promise.all([
      supabase.from("persons").select("full_name, email").eq("id", personId.data).maybeSingle(),
      // The caller's own phone (person_contact_details, 0082).
      supabase.from("person_contact_details").select("phone").eq("person_id", personId.data).maybeSingle(),
    ]);
    const p = data as { full_name: string | null; email: string | null } | null;
    replyTo = { name: p?.full_name ?? "", email: p?.email ?? "", phone: (contact as { phone: string | null } | null)?.phone ?? "" };
  }

  const illinois = (assoc.state_code ?? "").toUpperCase() === "IL";
  const inForce = inForceByCoverage(policies);
  const fundsShown = funds ? formatMoney(funds) : null;
  const pre = requestCoverages(policies, check);
  const preSet = new Map(pre.map((c) => [c.coverage, c.fromCheck]));
  const coverages = COVERAGE_TYPES.map((c) => ({
    coverage: c.value,
    label: c.short,
    preselected: preSet.has(c.value),
    fromCheck: preSet.get(c.value) === true,
    wanted: wantedFor(c.value, inForce.get(c.value) ?? null, funds && fundsShown ? { text: funds, shown: fundsShown } : null, illinois),
  }));
  const master = inForce.get("property") ?? null;
  const current: RequestFlowData["current"] = {};
  for (const [cov, p] of inForce) current[cov] = { carrier: p.carrier_name, renews_on: p.effective_to, premium: p.annual_premium };

  const street = assoc.street_address?.trim() ?? "";
  const cityLine = [assoc.city?.trim(), [assoc.state_code?.trim(), assoc.postal_code?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, kind: c.kind, email: c.email, isCurrentAgent: c.is_current_agent })),
    coverages,
    deductiblesToday: master
      ? {
          property: rowText(master, "property_deductible"),
          water: rowText(master, "water_damage_deductible"),
          wind_hail: rowText(master, "wind_hail_deductible"),
          wind_hail_percent: rowText(master, "wind_hail_deductible_percent"),
        }
      : null,
    current,
    association: {
      legal_name: assoc.legal_name?.trim() || assoc.display_name?.trim() || "",
      address: [street, cityLine].filter(Boolean).join(", "),
      city: assoc.city,
      units: ctx.unitCount,
      year_built: assoc.year_built,
      construction: assoc.construction_type,
      stories: assoc.stories,
      roof_replaced_year: assoc.roof_replaced_year,
      total_square_feet: facts?.total_square_feet ?? null,
      has_sprinklers: facts?.has_sprinklers ?? null,
      has_amenities: facts?.has_amenities ?? null,
      rental_share: facts?.rental_share ?? null,
    },
    addressMissing: !street || !assoc.city?.trim() || !assoc.state_code?.trim(),
    isAdmin: ctx.isAdmin,
    adminNames: admins,
    claims: ((claims.data ?? []) as { date_of_loss: string; description: string; status: string; amount_paid: string | null }[]),
    replyTo,
  };
}

/** "Brick (joisted masonry)" or null, for the read-only building summary. */
export const constructionWords = constructionLabel;

/** "Master policy, Liability" for chips and headers. */
export function coverageList(coverages: string[]): string {
  return coverages.map(coverageShort).join(", ");
}
