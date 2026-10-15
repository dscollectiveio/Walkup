import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/dates";
import { fromCents, toCents } from "@/lib/money/cents";
import { emptyFacts, type BuildingFacts } from "./facts";
import { policySelect, quoteSelect, type PolicyRow } from "./fields";
import { longDate } from "./format";
import type { CheckInput, CheckPolicy } from "./coverage-check";
import { ownerSummarySchema, ownerSummaryStaleness, type OwnerSummaryContent, type OwnerSummaryStaleness } from "./owner-summary";
import { withStatus, type PolicyStatus } from "./status";

/**
 * Loaders shared by the insurance pages and actions (insurance-spec §8, §9).
 * Everything runs under the caller's RLS; money and percents come back as
 * text (DECISIONS #20). Nothing here writes.
 */

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface InsuranceAssociation {
  id: string;
  legal_name: string | null;
  display_name: string | null;
  state_code: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  year_built: number | null;
  construction_type: string | null;
  stories: number | null;
  roof_replaced_year: number | null;
}

/** The one association visible to the caller (DECISIONS #11), or null. */
export async function currentAssociation(supabase: Supabase): Promise<InsuranceAssociation | null> {
  const { data } = await supabase
    .from("associations")
    .select("id, legal_name, display_name, state_code, street_address, city, postal_code, year_built, construction_type, stories, roof_replaced_year")
    .order("created_at")
    .order("id")
    .limit(1);
  return ((data ?? [])[0] as InsuranceAssociation | undefined) ?? null;
}

export async function isBoard(supabase: Supabase, associationId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_board", { assoc: associationId });
  return data === true;
}

export async function isBoardAdmin(supabase: Supabase, associationId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] });
  return data === true;
}

/** Names of the active board admins ("Pat Lee and Sam Ortiz"), for "Only {admin names} can …" copy. */
export async function adminNames(supabase: Supabase, associationId: string): Promise<string> {
  const { data } = await supabase
    .from("role_grants")
    .select("persons(full_name)")
    .eq("association_id", associationId)
    .eq("role", "board_admin")
    .is("revoked_at", null);
  const names = ((data ?? []) as { persons: { full_name: string } | { full_name: string }[] | null }[])
    .map((r) => (Array.isArray(r.persons) ? r.persons[0]?.full_name : r.persons?.full_name))
    .filter((n): n is string => Boolean(n?.trim()));
  if (names.length === 0) return "a board admin";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** §7.3.1: what a board member sees when the building's city or state is missing. */
export function addressMissingCopy(isAdmin: boolean, admins: string): string {
  return isAdmin
    ? "Add the building's city and state in Building Info to search."
    : `Only ${admins} can add the building's address. Ask them to add the city and state in Building Info.`;
}

export async function unitCount(supabase: Supabase, associationId: string): Promise<number> {
  const { count } = await supabase
    .from("units")
    .select("id", { count: "exact", head: true })
    .eq("association_id", associationId);
  return count ?? 0;
}

/** Who is looking: decides board, accountant, owner or restricted views (§3.3). */
export interface InsuranceContext {
  association: InsuranceAssociation;
  isBoard: boolean;
  isAdmin: boolean;
  canRead: boolean;
  isMember: boolean;
  unitCount: number;
  todayIso: string;
}

export async function loadInsuranceContext(supabase: Supabase): Promise<InsuranceContext | null> {
  const association = await currentAssociation(supabase);
  if (!association) return null;
  const assoc = association.id;
  const [board, admin, read, member, units] = await Promise.all([
    supabase.rpc("is_board", { assoc }),
    supabase.rpc("has_role_in", { assoc, roles: ["board_admin"] }),
    supabase.rpc("can_read_financials", { assoc }),
    supabase.rpc("is_member", { assoc }),
    unitCount(supabase, assoc),
  ]);
  return {
    association,
    isBoard: board.data === true,
    isAdmin: admin.data === true,
    canRead: read.data === true,
    isMember: member.data === true,
    unitCount: units,
    todayIso: todayIso(),
  };
}

export type PolicyWithStatus = PolicyRow & { status: PolicyStatus; renewed: boolean; successor_id: string | null };

/** Every policy row (archived included), money as text, with its computed status. */
export async function loadPolicies(supabase: Supabase, associationId: string, today = todayIso()): Promise<PolicyWithStatus[]> {
  const { data } = await supabase
    .from("insurance_policies")
    .select(policySelect())
    .eq("association_id", associationId)
    .order("effective_from", { ascending: false });
  const rows = (data ?? []) as unknown as PolicyRow[];
  return withStatus(rows, today).map((w) => ({
    ...w.policy,
    status: w.status,
    renewed: w.renewed,
    successor_id: w.successor?.id ?? null,
  }));
}

/** One policy with its status (successor considered), or null. */
export async function loadPolicy(supabase: Supabase, policyId: string, today = todayIso()): Promise<PolicyWithStatus | null> {
  const { data } = await supabase.from("insurance_policies").select(policySelect()).eq("id", policyId).maybeSingle();
  const row = (data ?? null) as unknown as PolicyRow | null;
  if (!row) return null;
  let successor: PolicyRow | null = null;
  if (row.replaced_by_policy_id) {
    const { data: s } = await supabase
      .from("insurance_policies")
      .select("id, coverage, effective_from, effective_to, archived_at, replaced_by_policy_id, replaced_at, renewal_reminder_days, carrier_name, annual_premium::text")
      .eq("id", row.replaced_by_policy_id)
      .maybeSingle();
    successor = (s ?? null) as unknown as PolicyRow | null;
  }
  const w = withStatus(successor ? [row, successor] : [row], today)[0];
  return { ...row, status: w.status, renewed: w.renewed, successor_id: successor?.id ?? null };
}

export type QuoteRow = Record<string, unknown> & {
  id: string; association_id: string; coverage: string; carrier_name: string; annual_premium: string;
  quoted_on: string; valid_until: string | null; was_selected: boolean; declined_at: string | null;
  contact_id: string | null; quote_request_id: string | null; document_id: string | null; updated_at: string;
};

export async function loadQuote(supabase: Supabase, quoteId: string): Promise<QuoteRow | null> {
  const { data } = await supabase.from("insurance_quotes").select(quoteSelect()).eq("id", quoteId).maybeSingle();
  return (data ?? null) as unknown as QuoteRow | null;
}

const FACT_SELECT =
  "id, association_id, is_condominium, replacement_cost_estimate::text, replacement_cost_as_of, replacement_cost_source, " +
  "building_count, total_square_feet, flood_zone, has_below_grade_units, has_basement, has_boiler, has_elevator, " +
  "has_sprinklers, has_employees, employee_count, uses_volunteers, has_commercial_space, has_amenities, " +
  "manager_handles_funds, management_company, rental_share::text, declaration_coverage_form, " +
  "declaration_required_lines, declaration_insurance_section, declaration_notes, owners_must_carry_ho6, " +
  "owners_ho6_min_liability::text, updated_at";

/** The facts row, or null when the board hasn't answered anything yet. */
export async function loadFacts(supabase: Supabase, associationId: string): Promise<BuildingFacts | null> {
  const { data } = await supabase
    .from("insurance_building_facts")
    .select(FACT_SELECT)
    .eq("association_id", associationId)
    .maybeSingle();
  if (!data) return null;
  return { ...emptyFacts(associationId), ...(data as unknown as Partial<BuildingFacts>) };
}

/** Sum of positive fund cash balances, as money text; null when the books have no cash lines. */
export async function fundsTotal(supabase: Supabase, associationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("fund_cash_balances")
    .select("cash_balance::text, visible_lines")
    .eq("association_id", associationId);
  if (error || !data) return null;
  const rows = data as unknown as { cash_balance: string | null; visible_lines: number }[];
  if (!rows.some((r) => Number(r.visible_lines) > 0)) return null;
  const cents = rows.reduce((sum, r) => {
    const c = r.cash_balance ? toCents(r.cash_balance) : 0;
    return c > 0 ? sum + c : sum;
  }, 0);
  return fromCents(cents);
}

/** Subtract days from a YYYY-MM-DD date (UTC arithmetic on the date part only). */
function minusDays(iso: string, days: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) - days));
  return d.toISOString().slice(0, 10);
}

/**
 * Everything runCoverageCheck() needs (§6.8), including the received quotes
 * that CP-DO-01 compares carriers against.
 */
export async function loadCheckInput(
  supabase: Supabase,
  association: Pick<InsuranceAssociation, "id" | "legal_name" | "state_code">,
  today = todayIso(),
): Promise<CheckInput> {
  const assoc = association.id;
  const [policies, facts, funds, units, history, quotes, dismissals] = await Promise.all([
    loadPolicies(supabase, assoc, today),
    loadFacts(supabase, assoc),
    fundsTotal(supabase, assoc),
    unitCount(supabase, assoc),
    supabase
      .from("insurance_year_over_year")
      .select("coverage, policy_id, change_percent::text, previous_premium::text, annual_premium::text, quotes_obtained")
      .eq("association_id", assoc),
    supabase
      .from("insurance_quotes")
      .select("coverage, carrier_name, quoted_on, declined_at")
      .eq("association_id", assoc),
    supabase
      .from("insurance_finding_dismissals")
      .select("rule_id, policy_id, finding_key, reason")
      .eq("association_id", assoc),
  ]);

  const checkPolicies: CheckPolicy[] = policies
    .filter((p) => p.status !== "archived")
    .map((p) => ({ ...p, status: p.status, renewed: p.renewed }));

  const quoteRows = (quotes.data ?? []) as { coverage: string; carrier_name: string; quoted_on: string; declined_at: string | null }[];
  const quotesThisTerm: Record<string, number> = {};
  for (const p of checkPolicies.filter((x) => x.status === "active")) {
    const from = minusDays(p.effective_to, 120);
    const n = quoteRows.filter((q) => q.coverage === p.coverage && q.quoted_on >= from && q.quoted_on <= today).length;
    quotesThisTerm[p.coverage] = Math.max(quotesThisTerm[p.coverage] ?? 0, n);
  }

  const historyRows = (history.data ?? []) as {
    coverage: string; policy_id: string; change_percent: string | null; previous_premium: string | null;
    annual_premium: string; quotes_obtained: number | null;
  }[];

  return {
    todayIso: today,
    stateCode: (association.state_code ?? "").toUpperCase(),
    unitCount: units,
    facts,
    policies: checkPolicies,
    fundsTotal: funds,
    history: historyRows.map((h) => ({
      coverage: h.coverage,
      policyId: h.policy_id,
      changePercent: h.change_percent,
      previousPremium: h.previous_premium,
      annualPremium: h.annual_premium,
      quotesObtained: Number(h.quotes_obtained ?? 0),
    })),
    legalName: association.legal_name,
    quotesThisTerm,
    dismissals: ((dismissals.data ?? []) as { rule_id: string; policy_id: string | null; finding_key: string; reason: string }[]).map((d) => ({
      ruleId: d.rule_id,
      policyId: d.policy_id,
      findingKey: d.finding_key,
      reason: d.reason,
    })),
    quotes: quoteRows.map((q) => ({ coverage: q.coverage, carrierName: q.carrier_name, declined: q.declined_at !== null })),
  };
}

/** The insurer-payee pattern of src/lib/plaid/suggest.ts's Insurance rule (not exported there), for the books hint (§9.1). */
export const INSURER_PAYEE_PATTERN = /west bend|\binsuran/i;

export interface OwnerSummaryRow {
  source_policy_id: string | null;
  source_hash: string | null;
  draft: OwnerSummaryContent | null;
  published: OwnerSummaryContent | null;
  published_at: string | null;
}

export async function loadOwnerSummary(supabase: Supabase, associationId: string): Promise<OwnerSummaryRow | null> {
  const { data } = await supabase
    .from("insurance_owner_summaries")
    .select("source_policy_id, source_hash, draft, published, published_at")
    .eq("association_id", associationId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { source_policy_id: string | null; source_hash: string | null; draft: unknown; published: unknown; published_at: string | null };
  const draft = ownerSummarySchema.safeParse(row.draft);
  const published = ownerSummarySchema.safeParse(row.published);
  return {
    source_policy_id: row.source_policy_id,
    source_hash: row.source_hash,
    draft: draft.success ? draft.data : null,
    published: published.success ? published.data : null,
    published_at: row.published_at,
  };
}

export interface InsuranceBanner {
  key: string;
  tone: "attention" | "bad";
  text: string;
  href: string;
  action: string;
  /** The owner-requests banner: the oldest open request, for "Mark done". */
  ownerRequestId?: string;
}

/**
 * The Overview's item 0 banners (§9.1), also used on Home (I-1): finished
 * reads waiting, reads that failed, open owner requests, and a stale owner
 * summary. Board only; empty for anyone else.
 */
export async function loadInsuranceBanners(supabase: Supabase, associationId: string, today = todayIso()): Promise<InsuranceBanner[]> {
  if (!(await isBoard(supabase, associationId))) return [];
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [reads, requests, summary] = await Promise.all([
    supabase
      .from("insurance_document_reads")
      .select("id, state, result, saved, created_at, documents(filename)")
      .eq("association_id", associationId)
      .gte("created_at", since30)
      .order("created_at", { ascending: false }),
    supabase
      .from("insurance_owner_requests")
      .select("id", { count: "exact" })
      .eq("association_id", associationId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(1),
    loadOwnerSummary(supabase, associationId),
  ]);

  const banners: InsuranceBanner[] = [];
  type ReadRow = {
    id: string; state: string; result: { policies?: unknown[] } | null; saved: Record<string, unknown> | null;
    created_at: string; documents: { filename: string } | { filename: string }[] | null;
  };
  for (const r of (reads.data ?? []) as unknown as ReadRow[]) {
    const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents;
    const filename = doc?.filename ?? "a file";
    const saved = r.saved ?? {};
    const count = Array.isArray(r.result?.policies) ? r.result.policies.length : 0;
    const open = Array.from({ length: count }, (_, i) => i).filter((i) => saved[String(i)] === undefined).length;
    const anySaved = Object.values(saved).some((v) => v && typeof v === "object" && ("policy_id" in v || "quote_id" in v));
    if (r.state === "done" && open > 0) {
      banners.push({
        key: `read:${r.id}`, tone: "attention",
        text: `Walkup finished reading ${filename}. Review and save ${open} ${open === 1 ? "policy" : "policies"}.`,
        href: `/insurance/import/${r.id}`, action: "Review",
      });
    } else if (["failed", "timed_out", "unreadable"].includes(r.state) && r.created_at >= since7 && !anySaved) {
      banners.push({
        key: `read:${r.id}`, tone: "bad", text: `Walkup couldn't read ${filename}.`,
        href: `/insurance/import/${r.id}`, action: "See why",
      });
    }
  }

  const asks = requests.count ?? 0;
  const oldest = ((requests.data ?? []) as { id: string }[])[0]?.id ?? null;
  if (asks > 0 && oldest) {
    // Oldest first: the compose form shows that owner's note (§9.1 item 0).
    banners.push({
      key: "owner_requests", tone: "attention",
      text: `${asks} ${asks === 1 ? "owner asks" : "owners ask"} for proof of the building's insurance.`,
      href: `/insurance/emails/new?kind=certificate_request&owner_request=${oldest}`,
      action: "Prepare the certificate request",
      ownerRequestId: oldest,
    });
  }

  if (summary?.published) {
    const staleness = await ownerSummaryStalenessFor(supabase, summary, today);
    const text = stalenessSentence(staleness);
    if (text) {
      banners.push({ key: "owner_summary", tone: "attention", text, href: "/insurance/owner-summary", action: "Update the owner summary" });
    }
  }
  return banners;
}

/** ownerSummaryStaleness() against the source policy as it is now. */
export async function ownerSummaryStalenessFor(
  supabase: Supabase,
  summary: OwnerSummaryRow,
  today = todayIso(),
): Promise<OwnerSummaryStaleness> {
  if (!summary.published) return { stale: false };
  const source = summary.source_policy_id ? await loadPolicy(supabase, summary.source_policy_id, today) : null;
  return ownerSummaryStaleness(
    { source_policy_id: summary.source_policy_id, source_hash: summary.source_hash, content: summary.published },
    source,
    today,
  );
}

/** The Overview and Home sentence for a stale owner summary (§9.1 item 0), or null. */
export function stalenessSentence(s: OwnerSummaryStaleness): string | null {
  if (!s.stale) return null;
  switch (s.reason) {
    case "ended":
    case "replaced":
      return s.endedOn
        ? `The owner summary describes the policy that ended ${longDate(s.endedOn)}. Update it.`
        : "The owner summary describes a policy that has ended. Update it.";
    case "archived":
    case "deleted":
      return "The owner summary describes a policy you archived. Update it.";
    default:
      return "You changed the master policy after publishing the owner summary. Update it.";
  }
}
