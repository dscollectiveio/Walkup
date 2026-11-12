/**
 * A readable name for a bank's shorthand: "INTRST PYMNT" becomes "Interest payment".
 * Only banking abbreviations are expanded, and only when one is present; every other
 * description is left exactly as the bank sent it (the raw text always stays visible
 * under the name, so nothing is hidden).
 */
const ABBREVIATIONS: Record<string, string> = {
  intrst: "interest",
  pymnt: "payment",
  pymt: "payment",
  pmt: "payment",
};

export function cleanPayeeName(description: string): string {
  const words = description.trim().split(/\s+/);
  let changed = false;
  const expanded = words.map((w) => {
    const full = ABBREVIATIONS[w.toLowerCase()];
    if (!full) return w;
    changed = true;
    return full;
  });
  if (!changed) return description;
  const sentence = expanded.join(" ").toLowerCase();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
