// Pure budget judgements for the Budget & spending page. Every figure is in
// integer cents; nothing here invents a number — when there isn't enough to
// say something honest, the functions return null.

export type BudgetStatus = "on_track" | "watch" | "over";

/** Up to this much over the pro-rated target is "watch", beyond it "over". */
export const WATCH_BAND = 0.1;

export function budgetStatus(
  spentCents: number,
  targetCents: number,
): { status: BudgetStatus; pctOver: number } {
  if (targetCents <= 0) {
    return spentCents > 0 ? { status: "over", pctOver: 100 } : { status: "on_track", pctOver: 0 };
  }
  if (spentCents <= targetCents) return { status: "on_track", pctOver: 0 };
  const pctOver = Math.round(((spentCents - targetCents) / targetCents) * 100);
  return { status: (spentCents - targetCents) / targetCents <= WATCH_BAND ? "watch" : "over", pctOver };
}

export interface ForecastInput {
  /** Operating spending so far this fiscal year, by account. */
  spentByAccount: { accountId: string; name: string; cents: number }[];
  /** Annual budget by account (operating). */
  budgetByAccount: Map<string, number>;
  fyStart: string; // ISO date
  fyEnd: string; // ISO date
  today: Date;
  /** Full months of the fiscal year that have passed. */
  monthsElapsed: number;
}

export interface Forecast {
  /** Positive = over budget at year end, negative = under. */
  overUnderCents: number;
  projectedCents: number;
  budgetCents: number;
  driver: { accountId: string; name: string; cents: number } | null;
  /** The driver accounts for most of the difference. */
  driverIsMost: boolean;
}

export const MIN_FORECAST_MONTHS = 3;

/**
 * Straight-line projection: what's been spent, divided by the share of the
 * fiscal year that has passed. Deliberately simple — a treasurer can check it
 * on a napkin. Null under three months of history or with no budget.
 */
export function forecastYearEnd(input: ForecastInput): Forecast | null {
  if (input.monthsElapsed < MIN_FORECAST_MONTHS) return null;
  const budgetCents = [...input.budgetByAccount.values()].reduce((s, v) => s + v, 0);
  if (budgetCents <= 0) return null;

  const start = new Date(`${input.fyStart}T00:00:00`).getTime();
  const end = new Date(`${input.fyEnd}T00:00:00`).getTime() + 86_400_000;
  const now = Math.min(Math.max(input.today.getTime(), start), end);
  const elapsed = (now - start) / (end - start);
  if (elapsed <= 0) return null;

  const accountIds = new Set([...input.budgetByAccount.keys(), ...input.spentByAccount.map((a) => a.accountId)]);
  const spent = new Map(input.spentByAccount.map((a) => [a.accountId, a]));

  let projectedCents = 0;
  const deltas: { accountId: string; name: string; cents: number }[] = [];
  for (const id of accountIds) {
    const s = spent.get(id);
    const projected = Math.round((s?.cents ?? 0) / elapsed);
    projectedCents += projected;
    deltas.push({ accountId: id, name: s?.name ?? "", cents: projected - (input.budgetByAccount.get(id) ?? 0) });
  }
  const overUnderCents = projectedCents - budgetCents;

  // The driver is the category pushing hardest in the same direction as the total.
  const sameDirection = deltas
    .filter((d) => d.name && (overUnderCents >= 0 ? d.cents > 0 : d.cents < 0))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const driver = sameDirection[0] ?? null;
  const driverIsMost = driver !== null && overUnderCents !== 0 && Math.abs(driver.cents) >= Math.abs(overUnderCents) * 0.5;

  return { overUnderCents, projectedCents, budgetCents, driver, driverIsMost };
}

/**
 * "Compared with last year, repairs are up $2,100 and everything else is
 * within $200." Null when there's no prior period to compare against.
 */
export function comparisonSentence(
  current: { name: string; cents: number }[],
  prior: { name: string; cents: number }[],
  formatMoney: (cents: number) => string,
  priorLabel: string,
): string | null {
  if (prior.length === 0 || current.length === 0) return null;
  const names = new Set([...current.map((c) => c.name), ...prior.map((p) => p.name)]);
  const cur = new Map(current.map((c) => [c.name, c.cents]));
  const pri = new Map(prior.map((p) => [p.name, p.cents]));
  const changes = [...names]
    .map((n) => ({ name: n, delta: (cur.get(n) ?? 0) - (pri.get(n) ?? 0) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = changes[0];
  if (!top || top.delta === 0) return `Compared with ${priorLabel}, spending by category is about the same.`;
  const rest = changes.slice(1);
  const restMax = rest.reduce((m, c) => Math.max(m, Math.abs(c.delta)), 0);
  const topPart = `${top.name.toLowerCase()} ${top.delta > 0 ? "is up" : "is down"} ${formatMoney(Math.abs(top.delta))}`;
  if (rest.length === 0) return `Compared with ${priorLabel}, ${topPart}.`;
  return `Compared with ${priorLabel}, ${topPart} and everything else is within ${formatMoney(restMax)}.`;
}
