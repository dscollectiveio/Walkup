/**
 * The 14 worked examples of repairs-spec §4.13, shared by the DB test of
 * `public.upkeep_next_due()` (tests/db/upkeep-v2) and the unit test of
 * `nextDueAfter()` (src/lib/upkeep/schedule.ts), so the SQL and the
 * TypeScript can't drift. `month` is the preferred month (1-12) or null.
 */
export interface UpkeepCase {
  doneOn: string;
  interval: number;
  month: number | null;
  expected: string;
  why: string;
}

export const UPKEEP_CASES: UpkeepCase[] = [
  { doneOn: "2026-09-14", interval: 12, month: 9, expected: "2027-09-30", why: "On time; lower bound 2027-03-14, first September end after it." },
  { doneOn: "2026-10-20", interval: 12, month: 9, expected: "2027-09-30", why: "Done late; stays a September job." },
  { doneOn: "2026-07-01", interval: 12, month: 9, expected: "2027-09-30", why: "Done early for the 2026 September slot; next is next September." },
  { doneOn: "2027-02-01", interval: 12, month: 9, expected: "2027-09-30", why: "Very late; the old rule skipped to 2028." },
  { doneOn: "2027-04-01", interval: 12, month: 9, expected: "2028-09-30", why: "Seven months late: lower bound 2027-10-01, so 2028." },
  { doneOn: "2026-04-10", interval: 6, month: 4, expected: "2026-10-31", why: "Anchors April and October; the old rule gave 2027-04-01." },
  { doneOn: "2026-06-01", interval: 6, month: 4, expected: "2026-10-31", why: "Late April service; October still next." },
  { doneOn: "2026-01-05", interval: 3, month: 1, expected: "2026-04-30", why: "Anchors Jan, Apr, Jul, Oct; the old rule gave a year." },
  { doneOn: "2026-12-20", interval: 3, month: 1, expected: "2027-04-30", why: "Done before the January slot counts as January's." },
  { doneOn: "2026-05-10", interval: 24, month: 5, expected: "2028-05-31", why: "Two-yearly; lower bound 2027-11-10." },
  { doneOn: "2026-02-15", interval: 24, month: 5, expected: "2028-05-31", why: "Early for May 2026; lower bound 2027-08-15." },
  { doneOn: "2026-01-31", interval: 1, month: null, expected: "2026-02-28", why: "Month-end clamp." },
  { doneOn: "2026-03-15", interval: 6, month: null, expected: "2026-09-15", why: "Plain interval." },
  { doneOn: "2028-02-29", interval: 12, month: null, expected: "2029-02-28", why: "Leap day clamp." },
];
