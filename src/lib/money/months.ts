// Month keys are the first of the month as "YYYY-MM-01" — the shape the
// monthly views return — so they compare and sort as plain strings.

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function monthKeyOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function dateOfKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

export function addMonths(key: string, n: number): string {
  const d = dateOfKey(key);
  return monthKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** Every month key from `start` to `end`, inclusive. Empty if end < start. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let k = start; k <= end; k = addMonths(k, 1)) out.push(k);
  return out;
}

export function monthShortLabel(key: string): string {
  return dateOfKey(key).toLocaleDateString("en-US", { month: "short" });
}

export function monthLongLabel(key: string, withYear = true): string {
  return dateOfKey(key).toLocaleDateString("en-US", {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
}
