// Pure rows for the spending breakdown: ranked categories with their share of
// the total, a per-month average, and everything small folded into "Other".
// Money stays in integer cents.

export interface BreakdownSlice {
  label: string;
  valueCents: number;
  href?: string;
}

export interface BreakdownRow extends BreakdownSlice {
  /** Exact share of the total, 0–100 (for drawing). */
  pct: number;
  /** Whole-number share for display. */
  pctLabel: number;
  perMonthCents: number | null;
}

export interface Breakdown {
  rows: BreakdownRow[];
  totalCents: number;
  biggest: BreakdownRow | null;
}

export function buildBreakdown(
  slices: BreakdownSlice[],
  opts: { maxRows?: number; monthCount?: number | null } = {},
): Breakdown {
  const maxRows = opts.maxRows ?? 6;
  const months = opts.monthCount && opts.monthCount > 0 ? opts.monthCount : null;
  const sorted = [...slices].filter((s) => s.valueCents > 0).sort((a, b) => b.valueCents - a.valueCents);
  const totalCents = sorted.reduce((s, x) => s + x.valueCents, 0);
  if (totalCents === 0) return { rows: [], totalCents: 0, biggest: null };

  const shown = sorted.length > maxRows ? sorted.slice(0, maxRows - 1) : sorted;
  const tail = sorted.length > maxRows ? sorted.slice(maxRows - 1) : [];
  if (tail.length > 0) {
    shown.push({ label: "Other", valueCents: tail.reduce((s, t) => s + t.valueCents, 0) });
  }

  const rows = shown.map((s) => ({
    ...s,
    pct: (s.valueCents / totalCents) * 100,
    pctLabel: Math.round((s.valueCents / totalCents) * 100),
    perMonthCents: months ? Math.round(s.valueCents / months) : null,
  }));
  return { rows, totalCents, biggest: rows.find((r) => r.label !== "Other") ?? rows[0] };
}
