import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CalendarTask {
  id: string;
  name: string;
  next_due_on: string;
  interval_months: number;
  /** A seasonal job: due on the last day of its months, not on the same day number. */
  due_month?: number | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Every date this job falls on within one month: its next due date, then each repeat. */
function occurrencesIn(task: CalendarTask, year: number, month: number): number[] {
  const [sy, sm, sd] = task.next_due_on.split("-").map(Number);
  const out: number[] = [];
  let i = 0;
  // Step by the job's own interval from its next due date; a short month clamps the day.
  for (;;) {
    const total = sm - 1 + i * Math.max(task.interval_months, 0);
    const y = sy + Math.floor(total / 12);
    const m = total % 12;
    if (y > year || (y === year && m > month)) break;
    if (y === year && m === month) {
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      out.push(task.due_month ? last : Math.min(sd, last));
    }
    if (task.interval_months <= 0) break;
    i += 1;
    if (i > 600) break;
  }
  return out;
}

/**
 * A plain month grid of the upkeep schedule. Each job sits on its next due
 * date and on the repeats that follow it; overdue ones are red. Server
 * rendered: the month is a link, no script.
 */
export function UpkeepCalendar({
  tasks,
  todayIso,
  month,
  hrefFor,
}: {
  tasks: CalendarTask[];
  todayIso: string;
  /** "YYYY-MM" */
  month: string;
  /** The URL for another month ("YYYY-MM"). */
  hrefFor: (month: string) => string;
}) {
  const [year, m1] = month.split("-").map(Number);
  const m = m1 - 1;
  const first = new Date(Date.UTC(year, m, 1));
  const daysInMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const label = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const prev = m === 0 ? `${year - 1}-12` : `${year}-${pad(m)}`;
  const next = m === 11 ? `${year + 1}-01` : `${year}-${pad(m + 2)}`;
  const thisMonth = todayIso.slice(0, 7);

  const byDay = new Map<number, CalendarTask[]>();
  for (const t of tasks) {
    for (const d of occurrencesIn(t, year, m)) byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }

  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold tracking-tight text-ink">{label}</h3>
        <div className="flex items-center gap-1">
          <Link href={hrefFor(prev)} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-paper text-ink hover:bg-fill">
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
          {month !== thisMonth ? (
            <Link href={hrefFor(thisMonth)} className="inline-flex min-h-[32px] items-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill">
              Today
            </Link>
          ) : null}
          <Link href={hrefFor(next)} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-paper text-ink hover:bg-fill">
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* Phones: a plain list of the month's jobs by date. */}
      <ul className="divide-y divide-line sm:hidden">
        {[...byDay.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([d, list]) => (
            <li key={d} className="flex gap-3 py-2 text-[13px]">
              <span className="figures w-8 shrink-0 text-ink">{d}</span>
              <span className="min-w-0">
                {list.map((t) => (
                  <Link key={t.id} href={`/repairs/upkeep/${t.id}`} className="block truncate font-medium text-ink underline-offset-2 hover:underline">
                    {t.name}
                  </Link>
                ))}
              </span>
            </li>
          ))}
        {byDay.size === 0 ? <li className="py-3 text-[13px] text-mute">Nothing due this month.</li> : null}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border border-line sm:block" aria-label={label}>
        <div className="grid grid-cols-7 border-b border-line bg-fill/60 text-center text-[11px] font-semibold uppercase tracking-wide text-ink">
          {DAYS.map((d) => (
            <div key={d} className="py-1.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const date = d === null ? null : iso(year, m, d);
            const isToday = date === todayIso;
            const list = d === null ? [] : (byDay.get(d) ?? []);
            return (
              <div
                key={i}
                className={`min-h-[5.5rem] border-b border-r border-line p-1.5 text-[12px] ${i % 7 === 6 ? "border-r-0" : ""} ${d === null ? "bg-fill/30" : "bg-paper"}`}
              >
                {d !== null ? (
                  <>
                    <span className={`figures inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] ${isToday ? "bg-ink text-paper" : "text-mute"}`}>{d}</span>
                    <ul className="mt-1 space-y-0.5">
                      {list.map((t) => (
                        <li key={t.id}>
                          <Link
                            href={`/repairs/upkeep/${t.id}`}
                            title={t.name}
                            className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              date !== null && date < todayIso ? "bg-bad-tint text-bad-text" : "bg-ink/10 text-ink"
                            } hover:brightness-95`}
                          >
                            {date !== null && date < todayIso ? <span className="sr-only">Past due: </span> : null}
                            {t.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-mute">Each job shows on its next due date and the dates after it. Red ones are past due.</p>
    </div>
  );
}
