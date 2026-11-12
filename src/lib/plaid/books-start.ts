/**
 * How many days of history to ask Plaid for, so the list starts where the books do.
 * No date, or one we can't read, keeps the full two years; anything older than two
 * years is capped there, and a very recent date still gets a month (Plaid's floor
 * is low but a month avoids missing a statement that straddles the start).
 */
export function daysSince(
  booksStart: string | undefined,
  today: Date = new Date(),
): number {
  if (!booksStart || !/^\d{4}-\d{2}-\d{2}$/.test(booksStart)) return 730;
  const start = new Date(`${booksStart}T00:00:00Z`).getTime();
  if (Number.isNaN(start)) return 730;
  const days = Math.ceil((today.getTime() - start) / 86_400_000);
  return Math.min(730, Math.max(30, days));
}
