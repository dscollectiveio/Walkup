import { fromCents, toCents } from "@/lib/tax/form1120h";
import type { StatementLine } from "@/lib/owner/statement";

/**
 * Totals for a statement period, from the same lines the page shows. The
 * running balance is computed in SQL (unit_statement); this only adds the
 * period's activity. Money text in, money text out. Pure.
 */
export interface StatementTotals {
  opening: string;
  charges: string;
  payments: string;
  adjustments: string;
  closing: string;
}

export function totalsOf(lines: Pick<StatementLine, "kind" | "charge" | "payment" | "adjustment" | "balance">[]): StatementTotals {
  const opening = lines.find((l) => l.kind === "opening")?.balance ?? "0.00";
  const rest = lines.filter((l) => l.kind !== "opening");
  const sum = (pick: (l: (typeof rest)[number]) => string | null) => rest.reduce((s, l) => s + toCents(pick(l) ?? "0.00"), 0);
  return {
    opening,
    charges: fromCents(sum((l) => l.charge)),
    payments: fromCents(sum((l) => l.payment)),
    adjustments: fromCents(sum((l) => l.adjustment)),
    closing: lines.length ? lines[lines.length - 1].balance : "0.00",
  };
}
