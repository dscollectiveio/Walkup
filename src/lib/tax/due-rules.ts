// Due dates come from a rule string recorded (and cited) on each verified
// form template — never from a date written into code. This is the one
// function that reads those strings. An unrecognized rule returns null and
// the date shows as unknown; it is never guessed.
//
// Grammar (one per template):
//   FY_END + <n> MONTHS, DAY <d|LAST>          — the 15th day of the 4th month after the fiscal year ends
//   CAL_YEAR_END + <n> MONTHS, DAY <d|LAST>    — e.g. January 31 after the calendar year of payment
//   INCORPORATION_ANNIVERSARY_MONTH, DAY <d|LAST>

export interface DueContext {
  /** Last day of the fiscal year the form covers, ISO. */
  fiscalYearEnd: string | null;
  /** Calendar year the form covers (1099/1096). */
  calendarYear: number | null;
  incorporatedOn: string | null;
  today: Date;
}

const iso = (y: number, m0: number, d: number) =>
  `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function dayIn(y: number, m0: number, day: string): string | null {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  if (day === "LAST") return iso(y, m0, last);
  const d = Number(day);
  if (!Number.isInteger(d) || d < 1 || d > last) return null;
  return iso(y, m0, d);
}

export function parseDueRule(rule: string): { kind: "fy" | "cal" | "anniv"; months: number; day: string } | null {
  const r = rule.trim().toUpperCase().replace(/\s+/g, " ");
  let m = r.match(/^(FY_END|CAL_YEAR_END) \+ (\d{1,2}) MONTHS?, DAY (\d{1,2}|LAST)$/);
  if (m) return { kind: m[1] === "FY_END" ? "fy" : "cal", months: Number(m[2]), day: m[3] };
  m = r.match(/^INCORPORATION_ANNIVERSARY_MONTH, DAY (\d{1,2}|LAST)$/);
  if (m) return { kind: "anniv", months: 0, day: m[1] };
  return null;
}

export function dueDate(rule: string | null, ctx: DueContext): string | null {
  if (!rule) return null;
  const p = parseDueRule(rule);
  if (!p) return null;

  if (p.kind === "fy") {
    if (!ctx.fiscalYearEnd) return null;
    const [y, mo] = ctx.fiscalYearEnd.split("-").map(Number);
    const target = new Date(Date.UTC(y, mo - 1 + p.months, 1));
    return dayIn(target.getUTCFullYear(), target.getUTCMonth(), p.day);
  }
  if (p.kind === "cal") {
    if (ctx.calendarYear === null) return null;
    const target = new Date(Date.UTC(ctx.calendarYear, 11 + p.months, 1));
    return dayIn(target.getUTCFullYear(), target.getUTCMonth(), p.day);
  }
  if (!ctx.incorporatedOn) return null;
  const month0 = Number(ctx.incorporatedOn.slice(5, 7)) - 1;
  const todayIso = iso(ctx.today.getFullYear(), ctx.today.getMonth(), ctx.today.getDate());
  const thisYear = dayIn(ctx.today.getFullYear(), month0, p.day);
  if (thisYear && thisYear >= todayIso) return thisYear;
  return dayIn(ctx.today.getFullYear() + 1, month0, p.day);
}
