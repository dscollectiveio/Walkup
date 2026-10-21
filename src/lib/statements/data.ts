import "server-only";
import type { Supabase } from "@/lib/repairs/server";
import { buildingTodayIso } from "@/lib/dates";
import type { StatementLine } from "@/lib/owner/statement";
import { totalsOf, type StatementTotals } from "./summary";
import { loadContactDetails } from "@/lib/people/contact-details";

/** Owners' full names and (when the caller may read them) mailing addresses, from the unit_owners rows. */
async function ownersWithAddresses(
  supabase: Supabase,
  rows: { effective_to: unknown; person_id: unknown; persons: unknown }[],
  today: string,
  withAddresses: boolean,
): Promise<{ full_name: string; mailing_address: string | null }[]> {
  const current = rows.filter((o) => !o.effective_to || (o.effective_to as string) >= today);
  // The accountant reads statements but not owners' addresses (0082): their pages never ask.
  const contacts = withAddresses ? await loadContactDetails(supabase, current.map((o) => o.person_id as string)) : new Map();
  return current.flatMap((o) => {
    const p = o.persons as unknown as { full_name: string } | null;
    return p ? [{ full_name: p.full_name, mailing_address: (contacts.get(o.person_id as string)?.mailing_address as string | null | undefined) ?? null }] : [];
  });
}

/**
 * Everything the statement PDF and the board's statements page need, read
 * through the caller's own client: unit_statement() and
 * unit_statement_summary() return nothing to anyone who is not a financial
 * reader or this unit's owner, so a stranger gets null (money spec 4.6, 8.6).
 */
export interface StatementData {
  associationName: string;
  unit: { id: string; label: string };
  /** Current owners the caller is allowed to see (an owner sees themselves). */
  ownerNames: string[];
  mailingAddress: string | null;
  from: string;
  to: string;
  generatedOn: string;
  /** The statement covers all activity on record (no start date was given). */
  allHistory: boolean;
  lines: StatementLine[];
  totals: StatementTotals;
  position: { owed: string; overdue: string; credit: string; net: string };
  /** Never an account number. */
  paymentNote: string;
}

export const PAYMENT_NOTE = "To pay, sign in to Walkup and open How to pay.";

export async function loadStatementData(
  supabase: Supabase,
  unitId: string,
  from: string,
  to: string,
  opts: { allHistory?: boolean; /** The accountant may not read owners' mailing addresses (0082). */ skipAddresses?: boolean } = {},
): Promise<StatementData | null> {
  const summary = await supabase.rpc("unit_statement_summary", { p_unit_id: unitId, p_as_of: to });
  if (summary.error) {
    console.error("[statements] summary", summary.error.code ?? "-");
    return null;
  }
  const srow = (Array.isArray(summary.data) ? summary.data[0] : summary.data) as
    | { unit_label: string; owed: string; overdue: string; credit: string; net: string }
    | undefined;
  if (!srow) return null;

  const [stmt, assoc, owners] = await Promise.all([
    supabase.rpc("unit_statement", { p_unit_id: unitId, p_from: from, p_to: to }),
    supabase.from("associations").select("display_name, legal_name").limit(1),
    supabase
      .from("unit_owners")
      .select("effective_to, person_id, persons(full_name)")
      .eq("unit_id", unitId)
      .order("effective_from"),
  ]);
  if (stmt.error) {
    console.error("[statements] lines", stmt.error.code ?? "-");
    return null;
  }
  const lines = ((stmt.data ?? []) as unknown as StatementLine[]).map((l) => ({ ...l }));
  const today = buildingTodayIso();
  const people = await ownersWithAddresses(supabase, owners.data ?? [], today, opts.skipAddresses !== true);

  return {
    associationName: (assoc.data?.[0]?.display_name as string) || (assoc.data?.[0]?.legal_name as string) || "Your association",
    unit: { id: unitId, label: srow.unit_label },
    ownerNames: people.map((p) => p.full_name),
    mailingAddress: people.find((p) => (p.mailing_address ?? "").trim())?.mailing_address?.trim() ?? null,
    from,
    to,
    generatedOn: today,
    allHistory: opts.allHistory === true,
    lines,
    totals: totalsOf(lines),
    position: { owed: srow.owed, overdue: srow.overdue, credit: srow.credit, net: srow.net },
    paymentNote: PAYMENT_NOTE,
  };
}

export interface LateFeeLetterData {
  associationName: string;
  boardContact: { name: string | null; email: string | null; phone: string | null };
  ownerName: string;
  mailingAddress: string | null;
  unitLabel: string;
  feeAmount: string;
  feeChargedOn: string;
  owed: string;
  generatedOn: string;
}

/** Board only: the late fee charge, its unit, current owners and the balance including the fee. */
export async function loadLateFeeLetter(supabase: Supabase, chargeId: string): Promise<LateFeeLetterData | null> {
  const { data: charge } = await supabase
    .from("assessment_charges")
    .select("id, unit_id, charge_type, amount, due_on, waived_at, written_off_at, units(label)")
    .eq("id", chargeId)
    .maybeSingle();
  if (!charge || charge.charge_type !== "late_fee" || charge.waived_at || charge.written_off_at) return null;
  const today = buildingTodayIso();
  const [summary, assoc, owners] = await Promise.all([
    supabase.rpc("unit_statement_summary", { p_unit_id: charge.unit_id, p_as_of: today }),
    supabase
      .from("associations")
      .select("display_name, legal_name, board_contact_name, board_contact_email, board_contact_phone")
      .limit(1),
    supabase
      .from("unit_owners")
      .select("effective_to, person_id, persons(full_name)")
      .eq("unit_id", charge.unit_id)
      .order("effective_from"),
  ]);
  const srow = (Array.isArray(summary.data) ? summary.data[0] : summary.data) as { owed: string } | undefined;
  if (!srow) return null;
  // Board only (the letter route checks), so the addresses are always asked for.
  const people = await ownersWithAddresses(supabase, owners.data ?? [], today, true);
  if (people.length === 0) return null;
  const a = assoc.data?.[0];
  const unit = charge.units as unknown as { label: string } | null;
  return {
    associationName: (a?.display_name as string) || (a?.legal_name as string) || "Your association",
    boardContact: {
      name: (a?.board_contact_name as string | null) ?? null,
      email: (a?.board_contact_email as string | null) ?? null,
      phone: (a?.board_contact_phone as string | null) ?? null,
    },
    ownerName: people.map((p) => p.full_name).join(" and "),
    mailingAddress: people.find((p) => (p.mailing_address ?? "").trim())?.mailing_address?.trim() ?? null,
    unitLabel: unit?.label ?? "your unit",
    feeAmount: Number(charge.amount).toFixed(2),
    feeChargedOn: charge.due_on as string,
    owed: srow.owed,
    generatedOn: today,
  };
}
