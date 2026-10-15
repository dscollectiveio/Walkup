/**
 * The `billNextDue` examples of repairs-spec §4.14, shared by the DB test of
 * `public.bill_next_due()` (tests/db/bills-v2) and the unit test of
 * `billNextDue()` (src/lib/upkeep/bills.ts), so the SQL and the TypeScript
 * can't drift.
 */
export interface BillCase {
  from: string;
  frequency: "monthly" | "quarterly" | "semiannual" | "annual";
  dueDay: number | null;
  expected: string;
}

export const BILL_CASES: BillCase[] = [
  { from: "2026-01-31", frequency: "monthly", dueDay: 31, expected: "2026-02-28" },
  { from: "2026-02-28", frequency: "monthly", dueDay: 31, expected: "2026-03-31" },
  { from: "2026-03-15", frequency: "quarterly", dueDay: null, expected: "2026-06-15" },
  { from: "2026-11-01", frequency: "annual", dueDay: 1, expected: "2027-11-01" },
];
