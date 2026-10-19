// A unit's calendar-year dues, in four quarters. Pure: whole cents in, whole
// cents out. The plan's yearly amount is split into four equal quarters (any
// odd cents go to the last), and the money the unit has paid fills them in
// order, Q1 first, so the bar reads as "how much of the year is covered".

export interface QuarterFill {
  /** "Q1" to "Q4". */
  label: string;
  /** What this quarter's share of the year is. */
  targetCents: number;
  /** How much of that share the money paid so far covers. */
  filledCents: number;
  /** 0 to 100, for the bar. */
  pct: number;
  /** The quarter the building's today falls in. */
  current: boolean;
}

export interface YearProgress {
  quarters: QuarterFill[];
  annualCents: number;
  paidCents: number;
  /** What is still to pay on the plan this year, never below zero. */
  remainingCents: number;
  /** Paid beyond the plan's yearly amount, never below zero. */
  aheadCents: number;
  /** What the quarters up to and including the current one add up to. */
  dueToDateCents: number;
  /** Paid is less than what the finished quarters add up to. */
  behind: boolean;
}

/** 1 to 4 for a yyyy-mm-dd date. */
export function quarterOf(iso: string): 1 | 2 | 3 | 4 {
  const month = Number(iso.slice(5, 7));
  return (Math.floor((Math.min(Math.max(month, 1), 12) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function yearProgress(annualCents: number, paidCents: number, todayKey: string): YearProgress {
  const annual = Math.max(0, Math.round(annualCents));
  const paid = Math.max(0, Math.round(paidCents));
  const base = Math.floor(annual / 4);
  const targets = [base, base, base, annual - base * 3];
  const currentQuarter = quarterOf(todayKey);

  let left = paid;
  const quarters = targets.map((target, i) => {
    const filled = Math.min(left, target);
    left -= filled;
    return {
      label: `Q${i + 1}`,
      targetCents: target,
      filledCents: filled,
      pct: target > 0 ? Math.round((filled / target) * 100) : 0,
      current: i + 1 === currentQuarter,
    };
  });

  // "Behind" is judged on the quarters that have fully passed, so a unit that
  // has not yet paid this quarter's share is not called late during the quarter.
  const passed = targets.slice(0, currentQuarter - 1).reduce((a, b) => a + b, 0);
  return {
    quarters,
    annualCents: annual,
    paidCents: paid,
    remainingCents: Math.max(annual - paid, 0),
    aheadCents: Math.max(paid - annual, 0),
    dueToDateCents: targets.slice(0, currentQuarter).reduce((a, b) => a + b, 0),
    behind: annual > 0 && paid < passed,
  };
}

/**
 * Dues a unit has paid in a calendar year, from two places that must not be
 * added twice:
 *   - bank deposits labeled "HOA dues" for the unit, whether posted to the
 *     books yet or not (a deposit with no open charge to apply to is booked
 *     straight to income and leaves no payment record, so only the bank row
 *     shows it);
 *   - payments recorded by hand (check, cash), which have no bank row.
 * A payment the bank feed made is a payment record too, so the caller passes
 * only the payments that did NOT come from a bank row in `otherPaymentCents`.
 * Whatever part of the money went to a late fee or one-off charge is taken
 * off, since the plan's yearly amount covers regular dues only.
 */
export function duesPaidCents(input: {
  bankCents: number[];
  otherPaymentCents: number[];
  /** Applied to late fees and one-off charges. */
  appliedToFeesCents: number;
  /** Applied to a required Additional Agreed Assessment's charge: counted there instead. */
  appliedToAdditionalCents?: number;
}): number {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return Math.max(
    sum(input.bankCents) + sum(input.otherPaymentCents) - Math.max(input.appliedToFeesCents, 0) - Math.max(input.appliedToAdditionalCents ?? 0, 0),
    0,
  );
}

export interface AdditionalProgress {
  /** What the unit has put toward it: contributions, payments applied to it, and extra dues rolled over. */
  givenCents: number;
  targetCents: number;
  /** 0 to 100, for the bar. */
  pct: number;
  /** Given beyond the agreed amount, never below zero. */
  aheadCents: number;
  remainingCents: number;
}

/**
 * Extra dues roll over: whatever a unit has paid toward regular dues beyond
 * the plan's yearly amount counts toward its Additional Agreed Assessment.
 * Money already applied to a required assessment's charge is taken out of
 * `duesMoneyCents` by the caller, so it is never counted twice.
 */
export function rolledOverCents(duesMoneyCents: number, annualDuesCents: number): number {
  if (annualDuesCents <= 0) return 0;
  return Math.max(Math.round(duesMoneyCents) - Math.round(annualDuesCents), 0);
}

export function additionalProgress(
  targetCents: number,
  parts: { contributedCents: number; appliedToChargeCents: number; rolledOverCents: number },
): AdditionalProgress {
  const target = Math.max(0, Math.round(targetCents));
  const given = Math.max(0, Math.round(parts.contributedCents) + Math.round(parts.appliedToChargeCents) + Math.round(parts.rolledOverCents));
  return {
    givenCents: given,
    targetCents: target,
    pct: target > 0 ? Math.min(100, Math.round((given / target) * 100)) : 0,
    aheadCents: Math.max(given - target, 0),
    remainingCents: Math.max(target - given, 0),
  };
}
