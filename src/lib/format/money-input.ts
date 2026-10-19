// Typing dollars into a box: "5400" shows as "$5,400" as you type, "1234.5" as
// "$1,234.5". Pure string work, no floating point: the raw value stays the
// digits (and at most two decimals) the person typed.

/** Digits and at most one decimal point with at most two decimals; no leading zeros. */
export function cleanMoney(input: string, maxDigits = 9): string {
  let out = "";
  let seenDot = false;
  let decimals = 0;
  let intDigits = 0;
  for (const ch of input) {
    if (ch >= "0" && ch <= "9") {
      if (seenDot) {
        if (decimals >= 2) continue;
        decimals += 1;
        out += ch;
      } else {
        if (intDigits >= maxDigits) continue;
        // Drop leading zeros ("007" becomes "7"), keep a single "0" before a dot.
        if (out === "0") out = "";
        intDigits += 1;
        out += ch;
      }
    } else if (ch === "." && !seenDot) {
      seenDot = true;
      if (out === "") out = "0";
      out += ".";
    }
  }
  return out;
}

/** "$1,234" or "$1,234.5" for a cleaned value; "" for nothing. */
export function displayMoney(raw: string): string {
  if (raw === "") return "";
  const [int, dec] = raw.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}${dec !== undefined ? `.${dec}` : ""}`;
}

/** Whole cents for a cleaned value, or 0. */
export function moneyToCents(raw: string): number {
  if (raw === "") return 0;
  const [int, dec = ""] = raw.split(".");
  return Number(int) * 100 + Number((dec + "00").slice(0, 2));
}

/** A number of dollars back to the cleaned form, e.g. 5400 to "5400", 12.5 to "12.5". */
export function cleanFromNumber(dollars: number | null | undefined): string {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars) || dollars <= 0) return "";
  return cleanMoney(String(dollars));
}

/**
 * Where the caret should go after reformatting: the same number of digits
 * (and the decimal point) to its left as before, so typing in the middle of a
 * number does not jump to the end.
 */
export function caretAfterFormat(typed: string, typedCaret: number, formatted: string): number {
  const significant = (s: string) => s.replace(/[^0-9.]/g, "").length;
  const target = significant(typed.slice(0, typedCaret));
  if (target === 0) return formatted.startsWith("$") ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/[0-9.]/.test(formatted[i])) seen += 1;
    if (seen === target) return i + 1;
  }
  return formatted.length;
}

// ---------------------------------------------------------------------------
// Whole numbers with thousands separators (square footage: 1,250).
// ---------------------------------------------------------------------------

/** Digits only, no leading zeros, at most `maxDigits` of them. */
export function cleanInteger(input: string, maxDigits = 7): string {
  const digits = input.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.slice(0, maxDigits);
}

/** "1250" as "1,250"; "" for nothing. */
export function displayInteger(raw: string): string {
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
