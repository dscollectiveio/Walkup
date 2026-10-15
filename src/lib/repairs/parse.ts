// Reading money and dates that came from a quote (repairs-spec §8.4). Pure.
// A figure the model copied from a quote is accepted only when it is one
// plain dollar amount; anything that needs interpreting (a range, "4.2k",
// a percentage, an hourly rate) becomes null and the board types it.

const MONEY = /^\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** "$4,250" / "4250.00" / "$4,250.5" -> "4250.00" / "4250.00" / "4250.50"; anything else -> null. */
export function parseMoneyText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim().replace(/^USD\s*/i, "").replace(/\s*USD$/i, "");
  const m = MONEY.exec(v);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (whole.length > 12) return null;
  return `${whole}.${(m[2] ?? "").padEnd(2, "0")}`;
}

/** "YYYY-MM-DD" that exists on the calendar, else null. */
export function isoDateOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? v : null;
}

/** Whitespace collapsed, em and en dashes written as commas, cut to `max` at a word boundary; "" -> null. */
export function cutText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const v = String(raw).replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]+/g, " ").trim();
  if (!v) return null;
  if (v.length <= max) return v;
  const head = v.slice(0, max);
  const at = head.lastIndexOf(" ");
  return (at > max * 0.6 ? head.slice(0, at) : head).trim();
}
