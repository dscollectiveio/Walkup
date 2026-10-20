import { toCents } from "@/lib/money/cents";

/**
 * A unit's dues standing in words, from the summary a SECURITY DEFINER reader gives a property manager
 * (manager_unit_standing) or an attorney (attorney_shared_units). Money arrives as text (DECISIONS #20) and
 * is compared in whole cents. Pure.
 */

export interface StandingFigures {
  owed: string;
  overdue: string;
  credit: string;
  net: string;
  open_charges: number;
  oldest_overdue_on: string | null;
}

export type StandingState = "behind" | "owes" | "current" | "ahead";

export interface StandingWords {
  state: StandingState;
  /** "Behind: $750.00 overdue since Jan 1" and the like, without the dollar sign formatting (the caller formats). */
  overdueCents: number;
  owedCents: number;
  creditCents: number;
}

export function standingOf(row: StandingFigures): StandingWords {
  const overdueCents = toCents(row.overdue);
  const owedCents = toCents(row.owed);
  const creditCents = toCents(row.credit);
  const state: StandingState =
    overdueCents > 0 ? "behind" : owedCents > 0 ? "owes" : creditCents > 0 ? "ahead" : "current";
  return { state, overdueCents, owedCents, creditCents };
}

export const STANDING_LABEL: Record<StandingState, string> = {
  behind: "Behind",
  owes: "Owes, not yet due",
  current: "Current",
  ahead: "Paid ahead",
};

/** Behind first (oldest overdue first), then the rest by unit order as given. */
export function sortByStanding<T extends StandingFigures>(rows: T[]): T[] {
  const rank = (r: T) => (standingOf(r).state === "behind" ? 0 : 1);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const d = rank(a.r) - rank(b.r);
      if (d !== 0) return d;
      if (rank(a.r) === 0) {
        const ao = a.r.oldest_overdue_on ?? "9999-12-31";
        const bo = b.r.oldest_overdue_on ?? "9999-12-31";
        if (ao !== bo) return ao < bo ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map((x) => x.r);
}
