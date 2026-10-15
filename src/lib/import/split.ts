/**
 * Ownership shares (import-spec 9.5 and 11.2). Pure.
 *
 * Percentages are stored numeric(9,6). `equalShares(n)` gives n strings with
 * six decimals that add up to exactly 100.000000, the extra millionths going
 * to the last units (3 -> 33.333333, 33.333333, 33.333334).
 */

export function equalShares(n: number): string[] {
  if (!Number.isInteger(n) || n < 1) throw new Error("equalShares needs a whole number of units, 1 or more.");
  const total = 100_000_000; // 100 percent in millionths
  const base = Math.floor(total / n);
  const extra = total - base * n; // always less than n
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    // The last `extra` units take one more millionth each.
    const millionths = base + (i >= n - extra ? 1 : 0);
    out.push(`${Math.floor(millionths / 1_000_000)}.${String(millionths % 1_000_000).padStart(6, "0")}`);
  }
  return out;
}

/** A share typed by a person: digits with up to six decimals, above 0 and at most 100. Null otherwise. */
export function parseShare(text: string): string | null {
  const t = text.trim().replace(/%$/, "").trim();
  const m = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(t);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(6, "0");
  const millionths = whole * 1_000_000 + Number(frac || "0");
  if (millionths <= 0 || millionths > 100_000_000) return null;
  return `${whole}.${frac}`;
}
