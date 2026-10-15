import { toCents, fromCents } from "@/lib/tax/form1120h";

/**
 * Money and date words for emails. Money is text end to end: nothing here
 * turns "750.00" into a float. Pure.
 */

function withCommas(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "1234.50" -> "$1,234.50"; "-12.50" -> "-$12.50". */
export function formatMoney(text: string): string {
  const cents = toCents(text);
  const abs = Math.abs(cents);
  const body = `$${withCommas(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${body}` : body;
}

/** A negative balance in prose: "-12.50" -> "$12.50 credit"; otherwise the money. */
export function formatBalanceWords(text: string): string {
  const cents = toCents(text);
  return cents < 0 ? `${formatMoney(fromCents(-cents))} credit` : formatMoney(text);
}

/** Sums money text without floating point. */
export function sumMoney(values: string[]): string {
  return fromCents(values.reduce((s, v) => s + toCents(v), 0));
}

export function isPositive(text: string): boolean {
  return toCents(text) > 0;
}

export function isZero(text: string): boolean {
  return toCents(text) === 0;
}
