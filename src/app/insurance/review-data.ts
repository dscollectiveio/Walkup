import "server-only";
import { coverageShort, isCoverageType, type CoverageType, type SectionKey } from "@/lib/insurance/coverage";
import { fromRecord, resolveAll, type FieldSource, type ResolvedField } from "@/lib/insurance/declarations";
import { FIELD_DEFS, type Endorsement, type Exclusion, type PremiumLine } from "@/lib/insurance/fields";
import { longDate } from "@/lib/insurance/format";
import type { InsuranceContext, PolicyWithStatus, Supabase } from "@/lib/insurance/queries";
import { loadPolicies } from "@/lib/insurance/queries";
import type { StoredPolicy } from "@/lib/insurance/read-schema";
import type { FieldMeta } from "@/lib/insurance/save-input";
import type { ProvenanceInfo } from "./components/provenance";
import type { EndorsementRow, ExclusionRow, PremiumLineRow, ReplaceableOption, ReviewFormProps } from "./components/review-types";

/**
 * Everything the review form needs besides the values themselves (§9.3.4):
 * the policies a new one may replace (with their premium bills), the expense
 * accounts, the saved contacts. Loaded once per page under the caller's RLS.
 */

export interface ReviewSupport {
  policies: PolicyWithStatus[];
  replaceable: ReplaceableOption[];
  accounts: { id: string; name: string }[];
  insuranceAccountId: string | null;
  contacts: { id: string; name: string }[];
  /** policy id -> active premium bill account */
  billByPolicy: Map<string, string>;
}

export async function loadReviewSupport(supabase: Supabase, ctx: InsuranceContext): Promise<ReviewSupport> {
  const assoc = ctx.association.id;
  const [policies, accounts, contacts, bills] = await Promise.all([
    loadPolicies(supabase, assoc, ctx.todayIso),
    supabase.from("accounts").select("id, name").eq("association_id", assoc).eq("type", "expense").eq("is_active", true).order("code"),
    supabase.from("insurance_contacts").select("id, name").eq("association_id", assoc).is("archived_at", null).order("name"),
    supabase
      .from("recurring_bills")
      .select("insurance_policy_id, account_id")
      .eq("association_id", assoc)
      .eq("is_active", true)
      .not("insurance_policy_id", "is", null),
  ]);
  const billByPolicy = new Map<string, string>();
  for (const b of (bills.data ?? []) as { insurance_policy_id: string; account_id: string }[]) {
    billByPolicy.set(b.insurance_policy_id, b.account_id);
  }
  const accountList = (accounts.data ?? []) as { id: string; name: string }[];
  const replaceable: ReplaceableOption[] = policies
    .filter((p) => p.status === "active" || p.status === "upcoming")
    .map((p) => ({
      id: p.id,
      label: `${coverageShort(p.coverage)}, ${p.carrier_name}, ends ${longDate(p.effective_to)}`,
      coverage: p.coverage,
      endsOn: p.effective_to,
      reminderDays: p.renewal_reminder_days,
      billAccountId: billByPolicy.get(p.id) ?? null,
      hasBill: billByPolicy.has(p.id),
    }));
  return {
    policies,
    replaceable,
    accounts: accountList,
    insuranceAccountId: accountList.find((a) => /insurance/i.test(a.name))?.id ?? null,
    contacts: (contacts.data ?? []) as { id: string; name: string }[],
    billByPolicy,
  };
}

const asCoverage = (c: string): CoverageType => (isCoverageType(c) ? c : "other");

/** jsonb list columns as editor rows. */
export function listRows(row: Record<string, unknown> | null): ReviewFormProps["lists"] {
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    endorsements: arr<Endorsement>(row?.endorsements).map((e) => ({ form_number: e.form_number ?? "", title: e.title ?? "", page: e.page ?? null })),
    exclusions: arr<Exclusion>(row?.exclusions).map((e) => ({ title: e.title ?? "", page: e.page ?? null })),
    premiumBreakdown: arr<PremiumLine>(row?.premium_breakdown).map((l) => ({ label: l.label ?? "", amount: l.amount ?? "", page: l.page ?? null })),
  };
}

/** A stored read item's lists as editor rows (page numbers kept). */
export function readListRows(item: StoredPolicy): ReviewFormProps["lists"] {
  return {
    endorsements: item.endorsements.map((e): EndorsementRow => ({ form_number: e.form_number ?? "", title: e.title, page: e.page })),
    exclusions: item.exclusions.map((e): ExclusionRow => ({ title: e.title, page: e.page })),
    premiumBreakdown: item.premiumLines.map((l): PremiumLineRow => ({ label: l.label, amount: l.amount, page: l.page })),
  };
}

/** Meta for values a form pre-fills: a read's high-confidence values are candidate 0; copied values keep their source. */
export function initialMetaFor(resolved: ResolvedField[], source: FieldSource | null): Record<string, FieldMeta> {
  const out: Record<string, FieldMeta> = {};
  for (const r of resolved) {
    if (r.value === null) continue;
    if (source === "extracted" && r.status === "high") out[r.key] = { source: "extracted", candidateIndex: 0 };
    else if (source === "quote" || source === "previous_policy") out[r.key] = { source, candidateIndex: null };
  }
  return out;
}

/** The read item's fields, resolved for every field key (so switching the kind of policy keeps them). */
export function resolvedFromRead(item: StoredPolicy): ResolvedField[] {
  return resolveAll(item.fields, FIELD_DEFS);
}

/** A saved row as prefilled fields, with the coverage set from the row. */
export function resolvedFromRow(row: Record<string, unknown>, source: FieldSource): ResolvedField[] {
  const resolved = fromRecord(row, FIELD_DEFS, source);
  return resolved.map((r) => (r.key === "policy_type" ? { ...r, value: asCoverage(String(row.coverage ?? "other")) } : r));
}

/** Stored provenance rows (insurance_policy_field_sources) as what the form and detail page show. */
export async function storedProvenance(
  supabase: Supabase,
  owner: { policyId?: string; quoteId?: string },
): Promise<{ byField: Record<string, ProvenanceInfo>; documentId: string | null }> {
  let q = supabase
    .from("insurance_policy_field_sources")
    .select("field_name, source, page_number, raw_text_snippet, confirmed_on, document_id");
  q = owner.policyId ? q.eq("policy_id", owner.policyId) : q.eq("quote_id", owner.quoteId as string);
  const { data } = await q;
  const byField: Record<string, ProvenanceInfo> = {};
  let documentId: string | null = null;
  for (const s of (data ?? []) as {
    field_name: string; source: string; page_number: number | null; raw_text_snippet: string | null;
    confirmed_on: string | null; document_id: string | null;
  }[]) {
    if (s.source === "extracted") {
      byField[s.field_name] = { source: "extracted", page: s.page_number, snippet: s.raw_text_snippet };
      documentId = documentId ?? s.document_id;
    } else if (s.source === "agent_confirmed") {
      byField[s.field_name] = { source: "agent_confirmed", confirmedOn: s.confirmed_on, attachmentId: s.document_id };
    } else if (s.source === "manual" || s.source === "quote" || s.source === "previous_policy") {
      byField[s.field_name] = { source: s.source };
    }
  }
  return { byField, documentId };
}

/** Defaults shared by every ReviewForm. */
export function baseReviewProps(
  ctx: InsuranceContext,
  support: ReviewSupport,
  over: Partial<ReviewFormProps> & Pick<ReviewFormProps, "mode" | "intent" | "coverage" | "resolved">,
): ReviewFormProps {
  return {
    includedSections: [] as SectionKey[],
    initialMeta: {},
    storedProvenance: {},
    lists: { endorsements: [], exclusions: [], premiumBreakdown: [] },
    documentId: null,
    readId: null,
    readIndex: null,
    documentFilename: null,
    pagesLabel: "",
    policyId: null,
    quoteId: null,
    expectedUpdatedAt: null,
    replaceable: support.replaceable,
    defaultReplacesId: null,
    acceptedQuoteId: null,
    quoteRequestId: null,
    contacts: support.contacts,
    defaultContactId: null,
    premiumBill: { exists: false, accounts: support.accounts, insuranceAccountId: support.insuranceAccountId },
    legalName: ctx.association.legal_name,
    policyNumberRedacted: false,
    renewalReminderDays: 60,
    notes: null,
    legacyValues: [],
    quoteMode: false,
    quotedOn: null,
    validUntil: null,
    carrierName: null,
    todayIso: ctx.todayIso,
    returnTo: null,
    ...over,
  };
}

/** "pages 1 to 3", "page 2", or "" for the import header. */
export function pagesLabel(pages: number[]): string {
  if (pages.length === 0) return "";
  const lo = Math.min(...pages);
  const hi = Math.max(...pages);
  return lo === hi ? `, page ${lo}` : `, pages ${lo} to ${hi}`;
}

/** A document's filename, or null. */
export async function documentFilename(supabase: Supabase, documentId: string | null): Promise<string | null> {
  if (!documentId) return null;
  const { data } = await supabase.from("documents").select("filename").eq("id", documentId).maybeSingle();
  return (data as { filename: string } | null)?.filename ?? null;
}

