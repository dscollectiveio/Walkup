/**
 * The four premium-installment cases from insurance-spec §6.6 / §13.1, shared
 * by the DB test of `insurance_premium_bill_advance()` (tests/db/insurance-v2)
 * and the unit test of `premiumSchedule()` / `premiumBillRetires()`
 * (src/lib/insurance/premium.ts), so the SQL and the TypeScript can't drift.
 *
 * `paidDueOn` is the installment just marked paid. `expected` is the next due
 * date the SQL returns, or null when the bill retires because the successor's
 * own bill has taken over. In TypeScript terms: with `todayIso` the day after
 * `paidDueOn`, `premiumSchedule(policy, todayIso).nextDueOn` equals `expected`,
 * and `premiumBillRetires(policy, successorStart, todayIso)` is
 * `expected === null`.
 */
export interface PremiumAdvanceCase {
  name: string;
  policy: { annual_premium: string; payment_schedule: string; effective_from: string; effective_to: string };
  paidDueOn: string;
  successorStart: string | null;
  expected: string | null;
}

export const PREMIUM_ADVANCE_CASES: PremiumAdvanceCase[] = [
  {
    name: "quarterly from Mar 1, paid for Jun 1: next is Sep 1",
    policy: { annual_premium: "4000.00", payment_schedule: "quarterly", effective_from: "2026-03-01", effective_to: "2027-03-01" },
    paidDueOn: "2026-06-01",
    successorStart: null,
    expected: "2026-09-01",
  },
  {
    name: "quarterly, paid for Dec 1, successor starts Mar 1: the bill retires",
    policy: { annual_premium: "4000.00", payment_schedule: "quarterly", effective_from: "2026-03-01", effective_to: "2027-03-01" },
    paidDueOn: "2026-12-01",
    successorStart: "2027-03-01",
    expected: null,
  },
  {
    name: "annual with no successor: next is the renewal date",
    policy: { annual_premium: "4000.00", payment_schedule: "annual", effective_from: "2026-03-01", effective_to: "2027-03-01" },
    paidDueOn: "2026-03-01",
    successorStart: null,
    expected: "2027-03-01",
  },
  {
    name: "monthly from Jan 31: next is Feb 28 (month end clamps)",
    policy: { annual_premium: "1200.00", payment_schedule: "monthly", effective_from: "2026-01-31", effective_to: "2027-01-31" },
    paidDueOn: "2026-01-31",
    successorStart: null,
    expected: "2026-02-28",
  },
];
