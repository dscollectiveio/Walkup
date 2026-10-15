// Side-by-side comparison of the current policy and the quotes received
// (insurance-spec §9.10). Lines up what each document states and marks
// differences against "Now"; it never scores or ranks. Money in cents,
// percents in bp4. Pure.

import { SECTION_KEYS, SECTION_LABEL } from "./coverage";
import { rowBool, rowText, type FieldDef } from "./fields";
import { bp4OrNull, centsOrNull, formatMoney } from "./format";
import { perUnitCost } from "./premium";
import { displayValue } from "./status";

export type Change =
  | "lower_limit" | "higher_limit" | "higher_deductible" | "lower_deductible" | "premium_up" | "premium_down"
  | "same" | "not_included" | "different" | "not_stated" | null;

export interface CompareCell {
  display: string | null;
  change: Change;
  tone: "warning" | "good" | "neutral" | null;
  pct?: string;
  /** "{label}: {value}, {change words}." on every cell with a change. */
  ariaLabel?: string;
}

export type Row = Record<string, unknown>;

export interface CompareRow { key: string; label: string; cells: CompareCell[] }
export interface CompareSection { section: string; rows: CompareRow[] }

/** Basics worth comparing; identity fields (number, names, address) and agent details aren't. */
const BASICS_SHOWN = new Set(["effective_on", "expires_on", "payment_schedule"]);
const PREMIUM_KEYS = new Set(["annual_premium", "taxes_and_fees"]);
const DIFFERENT_ENUMS = new Set(["coverage_form", "valuation", "cause_of_loss_form", "flood_program"]);

/** Deductible fields by key: ending in _deductible or _retention, `deductible`, or a percent deductible. */
export function isDeductibleKey(key: string): boolean {
  return /_deductible$|_retention$|^deductible$|_deductible_percent$/.test(key);
}

const CHANGE_WORDS: Record<Exclude<Change, null>, (pct?: string) => string> = {
  lower_limit: () => "lower than now",
  higher_limit: () => "higher than now",
  higher_deductible: () => "higher than now",
  lower_deductible: () => "lower than now",
  premium_up: (pct) => `${pct}% higher than now`,
  premium_down: (pct) => `${pct}% lower than now`,
  same: () => "same as now",
  not_included: () => "not included, unlike now",
  different: () => "different from now",
  not_stated: () => "not stated",
};

const CHIP: Record<Exclude<Change, null>, CompareCell["tone"]> = {
  lower_limit: "warning", higher_limit: "neutral", higher_deductible: "warning", lower_deductible: "neutral",
  premium_up: "warning", premium_down: "good", same: "neutral", not_included: "warning", different: "warning",
  not_stated: null,
};

/** The short chip text: "Lower limit", "+12%", "−8%", "Same", "Not included", "Different". */
export function chipText(cell: CompareCell): string | null {
  switch (cell.change) {
    case "lower_limit": return "Lower limit";
    case "higher_limit": return "Higher limit";
    case "higher_deductible": return "Higher deductible";
    case "lower_deductible": return "Lower deductible";
    case "premium_up": return `+${cell.pct}%`;
    case "premium_down": return `−${cell.pct}%`;
    case "same": return "Same";
    case "not_included": return "Not included";
    case "different": return "Different";
    default: return null;
  }
}

function withChange(label: string, display: string | null, change: Change, pct?: string): CompareCell {
  if (change === null) return { display, change: null, tone: null };
  return {
    display,
    change,
    tone: CHIP[change],
    ...(pct !== undefined ? { pct } : {}),
    ariaLabel: `${label}: ${display ?? "Not stated"}, ${CHANGE_WORDS[change](pct)}.`,
  };
}

/**
 * Percent change of b against a, from cents; null when a is 0. Whole percents
 * from half a percent up; below that one decimal ("0.4"), and "<0.1" for a
 * real but tiny difference. "Same" means exactly the same, never "rounds to 0".
 */
function pctChange(a: number, b: number): { change: Change; pct?: string } {
  if (a === b) return { change: "same" };
  if (a === 0) return { change: null };
  const exact = (Math.abs(b - a) * 100) / a;
  const whole = Math.round(exact);
  const tenths = Math.round(exact * 10) / 10;
  const pct = whole >= 1 ? String(whole) : tenths >= 0.1 ? tenths.toFixed(1) : "<0.1";
  return { change: b > a ? "premium_up" : "premium_down", pct };
}

function moneyChange(def: FieldDef, now: number, q: number): { change: Change; pct?: string } {
  if (PREMIUM_KEYS.has(def.key)) return pctChange(now, q);
  if (q === now) return { change: null };
  if (isDeductibleKey(def.key)) return { change: q > now ? "higher_deductible" : "lower_deductible" };
  return { change: q < now ? "lower_limit" : "higher_limit" };
}

function cellFor(def: FieldDef, current: Row | null, column: string | null, row: Row, isCurrent: boolean): CompareCell {
  const display = column ? displayValue({ ...def, column }, row) : null;
  if (isCurrent || !current) return { display, change: null, tone: null };
  const nowDisplay = displayValue(def, current);
  if (nowDisplay !== null && display === null) return withChange(def.label, null, "not_stated");
  if (nowDisplay === null || display === null || !column) return { display, change: null, tone: null };

  switch (def.kind) {
    case "money": {
      const now = centsOrNull(rowText(current, def.column));
      const q = centsOrNull(rowText(row, column));
      if (now === null || q === null) return { display, change: null, tone: null };
      const c = moneyChange(def, now, q);
      return withChange(def.label, display, c.change, c.pct);
    }
    case "percent": {
      const now = bp4OrNull(rowText(current, def.column));
      const q = bp4OrNull(rowText(row, column));
      if (now === null || q === null || now === q) return { display, change: null, tone: null };
      if (isDeductibleKey(def.key)) return withChange(def.label, display, q > now ? "higher_deductible" : "lower_deductible");
      if (def.key === "extended_replacement_percent") return withChange(def.label, display, q < now ? "lower_limit" : "higher_limit");
      return withChange(def.label, display, "different");
    }
    case "boolean": {
      const now = rowBool(current, def.column);
      const q = rowBool(row, column);
      return now === true && q === false ? withChange(def.label, display, "not_included") : { display, change: null, tone: null };
    }
    case "enum": {
      if (!DIFFERENT_ENUMS.has(def.key)) return { display, change: null, tone: null };
      const now = rowText(current, def.column);
      const q = rowText(row, column);
      return now !== q ? withChange(def.label, display, "different") : { display, change: null, tone: null };
    }
    default:
      return { display, change: null, tone: null };
  }
}

/**
 * Rows for the comparison: premium first (with "Per unit a month"), then the
 * dates and payment schedule, then each coverage section in order. Only
 * fields where at least one column has a value. `defs` are policy-mode defs
 * (fieldsFor(coverage, sections, "policy")): the current policy is read by
 * `column`, each quote by `quoteColumn`. Cells are [current, ...quotes]; the
 * current cell is "No current policy" territory when `current` is null (its
 * cells are then all empty).
 */
export function compareRows(current: Row | null, quotes: Row[], defs: FieldDef[], units: number): CompareSection[] {
  const columns: { row: Row; column: (d: FieldDef) => string | null; isCurrent: boolean }[] = [
    { row: current ?? {}, column: (d) => (current ? d.column : null), isCurrent: true },
    ...quotes.map((q) => ({ row: q, column: (d: FieldDef) => d.quoteColumn, isCurrent: false })),
  ];
  const rowFor = (def: FieldDef): CompareRow | null => {
    const cells = columns.map((c) => cellFor(def, current, c.column(def), c.row, c.isCurrent));
    return cells.some((c) => c.display !== null) ? { key: def.key, label: def.label, cells } : null;
  };

  const sections: CompareSection[] = [];

  // Premium first, plus per unit a month.
  const premiumRows: CompareRow[] = [];
  for (const def of defs.filter((d) => PREMIUM_KEYS.has(d.key))) {
    const r = rowFor(def);
    if (r) premiumRows.push(r);
  }
  const premiumDef = defs.find((d) => d.key === "annual_premium");
  if (premiumDef && units > 0) {
    const perMonth = (row: Row, column: string | null) => {
      const t = column ? rowText(row, column) : null;
      return t && centsOrNull(t) !== null ? perUnitCost(t, units)?.perMonth ?? null : null;
    };
    const label = "Per unit a month";
    const now = current ? perMonth(current, premiumDef.column) : null;
    const cells = columns.map((c): CompareCell => {
      const v = perMonth(c.row, c.column(premiumDef));
      const display = formatMoney(v, { cents: true });
      if (c.isCurrent || now === null || v === null) return { display, change: null, tone: null };
      const ch = pctChange(centsOrNull(now) as number, centsOrNull(v) as number);
      return withChange(label, display, ch.change, ch.pct);
    });
    if (cells.some((c) => c.display !== null)) premiumRows.push({ key: "per_unit_month", label, cells });
  }
  if (premiumRows.length) sections.push({ section: "Premium", rows: premiumRows });

  const basics = defs.filter((d) => d.group === "basics" && BASICS_SHOWN.has(d.key)).map(rowFor).filter((r): r is CompareRow => r !== null);
  if (basics.length) sections.push({ section: SECTION_LABEL.basics, rows: basics });

  for (const s of SECTION_KEYS) {
    const rows = defs.filter((d) => d.group === s).map(rowFor).filter((r): r is CompareRow => r !== null);
    if (rows.length) sections.push({ section: SECTION_LABEL[s], rows });
  }
  return sections;
}
