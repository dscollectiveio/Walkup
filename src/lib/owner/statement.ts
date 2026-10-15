// Statement words and periods (owner-portal-spec 4.3). Pure. The running
// balance is computed in SQL (unit_statement()); nothing here sums money.

import { money } from "@/components/ui";
import { longDate } from "@/lib/dates";

export type StatementKind = "opening" | "charge" | "payment" | "waiver" | "write_off";

export interface StatementLine {
  seq: number;
  line_date: string | null;
  kind: StatementKind;
  description: string;
  charge: string | null;
  payment: string | null;
  adjustment: string | null;
  /** Running balance as text. Below zero it is a credit. */
  balance: string;
  charge_id: string | null;
  payment_id: string | null;
}

export interface StatementPeriod {
  from: string | null;
  to: string | null;
  label: string;
}

export type PresetKey = "this_year" | "last_year" | "all";

export function presetPeriods(todayIso: string): { key: PresetKey; label: string; from: string | null; to: string | null }[] {
  const year = Number(todayIso.slice(0, 4));
  return [
    { key: "this_year", label: String(year), from: `${year}-01-01`, to: `${year}-12-31` },
    { key: "last_year", label: String(year - 1), from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
    { key: "all", label: "Everything", from: null, to: null },
  ];
}

function validIso(v: string | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (y < 1990 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  // 29 February moves to 1 March in a non-leap year; step back to the 28th.
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

const MAX_SPAN_YEARS = 10;

/** Query-string params to a period. Anything invalid falls back to this year. */
export function parsePeriodParams(sp: { from?: string; to?: string; preset?: string }, todayIso: string): StatementPeriod {
  const presets = presetPeriods(todayIso);
  const fallback = presets[0];
  const asPeriod = (p: (typeof presets)[number]): StatementPeriod => ({ from: p.from, to: p.to, label: p.label });

  const named = presets.find((p) => p.key === sp.preset);
  if (named) return asPeriod(named);

  const hasFrom = sp.from !== undefined && sp.from !== "";
  const hasTo = sp.to !== undefined && sp.to !== "";
  if (!hasFrom && !hasTo) return asPeriod(fallback);
  if ((hasFrom && !validIso(sp.from)) || (hasTo && !validIso(sp.to))) return asPeriod(fallback);

  let from = hasFrom ? sp.from! : null;
  let to = hasTo ? sp.to! : null;
  if (from && to && to < from) [from, to] = [to, from];
  if (from && to && shiftYears(from, MAX_SPAN_YEARS) < to) from = shiftYears(to, -MAX_SPAN_YEARS);

  const label = from && to ? `${longDate(from)} to ${longDate(to)}` : from ? `From ${longDate(from)}` : `Up to ${longDate(to!)}`;
  return { from, to, label };
}

/**
 * How a line's amount reads. Charges add (+), payments take away (-) in the
 * good tone, waivers and write-offs take away (-) in neutral ink. The opening
 * line has no amount. `text` is the formatted money without the sign.
 */
export function lineAmount(l: StatementLine): { text: string; tone: "good" | "neutral"; sign: "+" | "-" | "" } {
  switch (l.kind) {
    case "charge":
      return { text: money(l.charge), tone: "neutral", sign: "+" };
    case "payment":
      return { text: money(l.payment), tone: "good", sign: "-" };
    case "waiver":
    case "write_off":
      return { text: money(l.adjustment), tone: "neutral", sign: "-" };
    default:
      return { text: "", tone: "neutral", sign: "" };
  }
}

/** "500.00" -> "$500.00 owed"; "-250.00" -> "$250.00 credit"; "0.00" -> "Paid up". */
export function balanceWords(balanceText: string): string {
  const n = Math.round(Number(balanceText) * 100);
  if (!Number.isFinite(n) || n === 0) return "Paid up";
  return n > 0 ? `${money(n / 100)} owed` : `${money(-n / 100)} credit`;
}

/** A line's "what happened" for a phone card: "+$750.00 charged", "-$750.00 paid", "-$25.00 waived". */
export function lineSummary(l: StatementLine): string {
  const a = lineAmount(l);
  if (l.kind === "charge") return `${a.sign}${a.text} charged`;
  if (l.kind === "payment") return `${a.sign}${a.text} paid`;
  if (l.kind === "waiver") return `${a.sign}${a.text} waived`;
  if (l.kind === "write_off") return `${a.sign}${a.text} written off`;
  return "";
}
