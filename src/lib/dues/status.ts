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

/**
 * A unit is behind when anything is owed past its due date; ahead when it
 * has an unapplied credit; current when nothing is owed; "not charged yet"
 * when it has never been billed at all.
 */
export function standingFor(
  charges: ChargeLine[],
  unappliedCents: number,
  todayIso: string,
): { standing: UnitStanding; owedCents: number; overdueCents: number } {
  const owed = charges
    .filter((c) => c.status === "open" || c.status === "partial")
    .reduce((s, c) => s + c.balanceCents, 0);
  const overdue = charges
    .filter((c) => (c.status === "open" || c.status === "partial") && c.due_on < todayIso)
    .reduce((s, c) => s + c.balanceCents, 0);
  if (charges.length === 0) return { standing: "not_charged", owedCents: 0, overdueCents: 0 };
  if (overdue > 0) return { standing: "behind", owedCents: owed, overdueCents: overdue };
  if (owed === 0 && unappliedCents > 0) return { standing: "ahead", owedCents: 0, overdueCents: 0 };
  return { standing: "current", owedCents: owed, overdueCents: 0 };
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
