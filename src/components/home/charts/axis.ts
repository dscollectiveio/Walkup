// Shared axis maths for the Home charts. Values are integer cents, and every
// tick lands on a round number (1, 2 or 5 × a power of ten) so gridlines read
// as "$5k, $10k, $15k" rather than "$4,812".

export interface NiceAxis {
  /** Tick values, ascending, in cents. */
  ticks: number[];
  lo: number;
  hi: number;
}

export function niceAxis(min: number, max: number, targetTicks = 4): NiceAxis {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi === lo) {
    // A flat series still needs a visible span.
    hi = lo + Math.max(Math.abs(lo), 100);
  }
  const rawStep = (hi - lo) / Math.max(1, targetTicks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;

  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t));
  return { ticks, lo: ticks[0], hi: ticks[ticks.length - 1] };
}

/** "$0", "$800", "$1.5k", "$12k", "$2.4M", "−$3k" — compact, for axis labels. */
export function axisMoney(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "−" : "";
  const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}
