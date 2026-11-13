/**
 * Pure rules for the Dues page: what to call a unit's standing, which late
 * fees may be proposed, and which unit a bank deposit probably belongs to.
 * Nothing here writes anything; every output is a suggestion a person acts
 * on. Integer cents throughout.
 */

export type UnitStanding = "current" | "behind" | "ahead" | "not_charged";

export const STANDING_WORDS: Record<UnitStanding, string> = {
  current: "up to date",
  behind: "behind",
  ahead: "paid ahead",
  not_charged: "not charged yet",
};

export interface ChargeLine {
  id: string;
  unit_id: string;
  charge_type: "assessment" | "special_assessment" | "late_fee" | "other";
  period_start: string;
  due_on: string;
  amountCents: number;
  balanceCents: number;
  status: "open" | "partial" | "paid" | "waived" | "written_off";
  days_overdue: number;
}

/** The date `n` days after an ISO day. */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

/** A charge is past due once its due date plus the grace period has passed. */
export function isPastDue(dueOn: string, todayIso: string, graceDays = 0): boolean {
  return addDaysIso(dueOn, graceDays) < todayIso;
}

export interface UnitBuckets {
  standing: UnitStanding;
  /** Past due plus due soon: every unpaid charge. */
  owedCents: number;
  /** Unpaid charges whose due date plus the grace period has passed. */
  overdueCents: number;
  /** Unpaid charges already billed but not yet past due. */
  dueSoonCents: number;
  /** The earliest due date among the due-soon charges. */
  dueSoonOn: string | null;
}

/**
 * Two buckets, used everywhere on the Dues page. Past due: billed, not fully
 * paid, and the due date plus the grace period has passed. Due soon: billed,
 * not fully paid, not past due yet. A unit is behind when anything is past
 * due; ahead when it has an unapplied credit and owes nothing; "not charged
 * yet" when it has never been billed at all.
 */
export function standingFor(
  charges: ChargeLine[],
  unappliedCents: number,
  todayIso: string,
  graceDays = 0,
): UnitBuckets {
  const unpaid = charges.filter((c) => (c.status === "open" || c.status === "partial") && c.balanceCents > 0);
  const pastDue = unpaid.filter((c) => isPastDue(c.due_on, todayIso, graceDays));
  const soon = unpaid.filter((c) => !isPastDue(c.due_on, todayIso, graceDays));
  const sum = (xs: ChargeLine[]) => xs.reduce((t, c) => t + c.balanceCents, 0);
  const overdue = sum(pastDue);
  const dueSoon = sum(soon);
  const dueSoonOn = soon.map((c) => c.due_on).sort()[0] ?? null;
  const base = { owedCents: overdue + dueSoon, overdueCents: overdue, dueSoonCents: dueSoon, dueSoonOn };
  if (charges.length === 0) return { standing: "not_charged", ...base };
  if (overdue > 0) return { standing: "behind", ...base };
  if (base.owedCents === 0 && unappliedCents > 0) return { standing: "ahead", ...base };
  return { standing: "current", ...base };
}

/** This calendar year's charges for a unit: what was billed and how much of it is paid. Waived and written-off charges are left out. */
export function yearCharged(charges: ChargeLine[], year: string): { chargedCents: number; paidCents: number } {
  let chargedCents = 0;
  let paidCents = 0;
  for (const c of charges) {
    if (c.status === "waived" || c.status === "written_off") continue;
    if (c.period_start.slice(0, 4) !== year) continue;
    chargedCents += c.amountCents;
    paidCents += c.amountCents - c.balanceCents;
  }
  return { chargedCents, paidCents };
}

/** The earliest due date, on or after today, among unpaid charges. Null when none. */
export function nextDueOn(charges: ChargeLine[], todayIso: string): string | null {
  const dates = charges
    .filter((c) => (c.status === "open" || c.status === "partial") && c.balanceCents > 0 && c.due_on >= todayIso)
    .map((c) => c.due_on)
    .sort();
  return dates[0] ?? null;
}

export interface LateFeeRule {
  amountCents: number | null;
  graceDays: number | null;
}

export interface LateFeeProposal {
  unit_id: string;
  /** The overdue assessment the fee is for. */
  charge_id: string;
  period_start: string;
  daysOverdue: number;
  amountCents: number;
}

/**
 * One fee per overdue assessment per period, never a fee on a fee, never
 * twice for the same period. Only proposed — a person confirms each one.
 */
export function lateFeeProposals(charges: ChargeLine[], rule: LateFeeRule): LateFeeProposal[] {
  if (!rule.amountCents || rule.amountCents <= 0 || rule.graceDays === null) return [];
  const existingFees = new Set(
    charges.filter((c) => c.charge_type === "late_fee").map((c) => `${c.unit_id}:${c.period_start}`),
  );
  return charges
    .filter(
      (c) =>
        (c.charge_type === "assessment" || c.charge_type === "special_assessment") &&
        (c.status === "open" || c.status === "partial") &&
        c.days_overdue > (rule.graceDays ?? 0) &&
        !existingFees.has(`${c.unit_id}:${c.period_start}`),
    )
    .map((c) => ({
      unit_id: c.unit_id,
      charge_id: c.id,
      period_start: c.period_start,
      daysOverdue: c.days_overdue,
      amountCents: rule.amountCents as number,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export interface UnitHint {
  unit_id: string;
  label: string;
  ownerNames: string[];
  owedCents: number;
  /** What one period's dues come to for this unit, if a schedule exists. */
  perPeriodCents: number | null;
}

export interface DepositMatch {
  unit_id: string;
  confidence: "high" | "medium";
  reason: string;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);

/**
 * Which unit a bank deposit most likely belongs to. Name in the description
 * beats amount alone; amount matching what the unit owes beats matching one
 * period's dues. Returns at most one suggestion; ties mean no suggestion,
 * because a wrong guess costs more than no guess.
 */
export function suggestUnitForDeposit(
  deposit: { description: string; amountCents: number },
  units: UnitHint[],
  reports: { unit_id: string; amountCents: number; paid_on: string }[] = [],
  depositDate?: string,
): DepositMatch | null {
  const dwords = words(deposit.description);
  const scored = units.map((u) => {
    let score = 0;
    const reasons: string[] = [];
    const nameHit = u.ownerNames.some((n) => [...words(n)].some((w) => dwords.has(w)));
    if (nameHit) {
      score += 3;
      reasons.push("the payer's name matches");
    }
    const report = reports.find(
      (r) =>
        r.unit_id === u.unit_id &&
        r.amountCents === deposit.amountCents &&
        (!depositDate || Math.abs(new Date(r.paid_on).getTime() - new Date(depositDate).getTime()) <= 10 * 86_400_000),
    );
    if (report) {
      score += 3;
      reasons.push("the owner reported this payment");
    }
    if (u.owedCents > 0 && u.owedCents === deposit.amountCents) {
      score += 2;
      reasons.push("it's exactly what the unit owes");
    } else if (u.perPeriodCents && u.perPeriodCents === deposit.amountCents) {
      score += 1;
      reasons.push("it's one period's dues");
    }
    return { u, score, reasons };
  });
  const best = [...scored].sort((a, b) => b.score - a.score);
  if (best.length === 0 || best[0].score === 0) return null;
  if (best.length > 1 && best[1].score === best[0].score) return null;
  return {
    unit_id: best[0].u.unit_id,
    confidence: best[0].score >= 3 ? "high" : "medium",
    reason: best[0].reasons.join(" and "),
  };
}
