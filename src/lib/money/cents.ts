// Exact money arithmetic in integer cents (DECISIONS #20). Moved verbatim
// from src/lib/tax/form1120h.ts, which re-exports both.

/**
 * "1234.56" -> 123456. Rejects anything that is not a plain decimal string.
 *
 * The string requirement is the point, not pedantry. PostgREST serializes
 * NUMERIC to a JSON *number*, i.e. an IEEE 754 double, so a money value that
 * arrives here as `number` has already lost the exactness NUMERIC(14,2) was
 * chosen to guarantee. Accepting it — even by rounding politely — would hide
 * that. Every money column crossing this boundary is cast to text in SQL
 * (migration 0011); anything else is a bug upstream and should say so.
 */
export function toCents(numeric: string): number {
  if (typeof numeric !== "string") {
    throw new Error(
      `money must cross the API boundary as text, not ${typeof numeric}: ` +
        `${JSON.stringify(numeric)}. Cast the column to ::text in SQL. ` +
        `PostgREST turns NUMERIC into a float.`,
    );
  }
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(numeric.trim());
  if (!m) throw new Error(`not a NUMERIC(14,2) value: ${JSON.stringify(numeric)}`);
  const [, sign, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  // Beyond 2^53 cents the arithmetic downstream is silently wrong; refuse instead.
  if (!Number.isSafeInteger(cents)) throw new Error(`not a NUMERIC(14,2) value: ${JSON.stringify(numeric)}`);
  // "-0.00" is zero, not negative zero.
  return sign === "-" ? -cents || 0 : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
