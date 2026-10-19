// A unit's bathrooms as one number with one decimal: 2.5 is two full baths and
// a half bath, 1.0 is one full bath. The database keeps full and half baths in
// two columns; this turns them into the single figure people think in, and back.
// Only whole and half baths exist, so anything between is rounded to the
// nearest half.

/** Full and half baths as one number, or null when neither is on file. */
export function bathroomsValue(full: number | null | undefined, half: number | null | undefined): number | null {
  if ((full === null || full === undefined) && (half === null || half === undefined)) return null;
  return (full ?? 0) + (half ?? 0) * 0.5;
}

/** "2.0", "2.5", "1.0": always one decimal. */
export function formatBathrooms(value: number): string {
  return value.toFixed(1);
}

/** What was typed, rounded to the nearest half bath and limited to a sensible range; null for blank or not a number. */
export function snapBathrooms(input: string): number | null {
  const text = input.trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n * 2) / 2, 99);
}

/** The two database columns for a number of baths. */
export function splitBathrooms(value: number): { full: number; half: number } {
  const full = Math.floor(value);
  return { full, half: value - full >= 0.5 ? 1 : 0 };
}
