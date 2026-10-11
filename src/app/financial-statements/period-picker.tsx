"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { statementHref, type PeriodGrain } from "./periods";
import { monthOffsetFor, pickerBounds, quarterOffsetFor } from "./summary";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GRAINS: { key: PeriodGrain; label: string }[] = [
  { key: "monthly", label: "Month" },
  { key: "quarterly", label: "Quarter" },
  { key: "annual", label: "Year" },
];

/**
 * Pick a month, a quarter or a fiscal year without scrolling a long list:
 * one button showing what you're looking at, which opens a small panel —
 * Month / Quarter / Year tabs, a year stepper, and a grid to click. Picking
 * navigates; the page re-renders on the server for that period.
 */
export function PeriodPicker({
  label,
  current,
  currentStart,
  fiscalYears,
  today,
  sort,
}: {
  label: string;
  current: { period: PeriodGrain; offset: number };
  /** First day of the period on screen — tells the picker which year and month are selected. */
  currentStart: string | null;
  fiscalYears: { label: string; starts_on: string }[];
  /** "YYYY-MM-DD", from the server so the grid never disagrees with the page. */
  today: string;
  sort: "account" | "size";
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [grain, setGrain] = useState<PeriodGrain>(current.period);

  const bounds = pickerBounds(fiscalYears, today);
  const selYear = currentStart ? Number(currentStart.slice(0, 4)) : bounds.maxYear;
  const [year, setYear] = useState(Math.min(bounds.maxYear, Math.max(bounds.minYear, selYear)));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (period: PeriodGrain, offset: number) => {
    setOpen(false);
    router.push(
      statementHref("/financial-statements", "total", period, offset, { sort: sort === "size" ? "size" : undefined }),
    );
  };

  const isCurrent = (period: PeriodGrain, offset: number) => current.period === period && current.offset === offset;
  const cell = (selected: boolean, disabled: boolean) =>
    `flex h-10 items-center justify-center rounded-md text-[13px] font-medium transition-colors ${
      selected
        ? "bg-ink text-paper"
        : disabled
          ? "cursor-not-allowed text-mute-soft opacity-40"
          : "text-ink hover:bg-fill"
    }`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setGrain(current.period);
          setYear(Math.min(bounds.maxYear, Math.max(bounds.minYear, selYear)));
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-9 min-w-[11rem] items-center justify-between gap-2 rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-mute" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a period"
          className="absolute left-0 top-full z-30 mt-1.5 w-[19rem] rounded-xl border border-line bg-paper p-3 shadow-lg"
        >
          <div role="tablist" aria-label="Period type" className="grid grid-cols-3 gap-1 rounded-lg bg-fill p-1">
            {GRAINS.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={grain === g.key}
                onClick={() => setGrain(g.key)}
                className={`h-8 rounded-md text-[12px] font-medium ${
                  grain === g.key ? "bg-paper text-ink shadow-sm" : "text-mute hover:text-ink"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          {grain !== "annual" ? (
            <>
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous year"
                  disabled={year <= bounds.minYear}
                  onClick={() => setYear((y) => y - 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-ink hover:bg-fill disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
                </button>
                <span className="figures text-[14px] text-ink">{year}</span>
                <button
                  type="button"
                  aria-label="Next year"
                  disabled={year >= bounds.maxYear}
                  onClick={() => setYear((y) => y + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-ink hover:bg-fill disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
                </button>
              </div>

              {grain === "monthly" ? (
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {MONTHS.map((m, i) => {
                    const idx = year * 12 + i;
                    const disabled = idx < bounds.minMonthIndex || idx > bounds.maxMonthIndex;
                    const offset = monthOffsetFor(year, i + 1, today);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={disabled}
                        aria-pressed={isCurrent("monthly", offset)}
                        onClick={() => go("monthly", offset)}
                        className={cell(isCurrent("monthly", offset), disabled)}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((q) => {
                    const firstMonth = year * 12 + (q - 1) * 3;
                    const disabled = firstMonth + 2 < bounds.minMonthIndex || firstMonth > bounds.maxMonthIndex;
                    const offset = quarterOffsetFor(year, q, today);
                    return (
                      <button
                        key={q}
                        type="button"
                        disabled={disabled}
                        aria-pressed={isCurrent("quarterly", offset)}
                        onClick={() => go("quarterly", offset)}
                        className={`${cell(isCurrent("quarterly", offset), disabled)} flex-col gap-0 leading-tight`}
                      >
                        <span>Q{q}</span>
                        <span className="text-[10px] font-normal opacity-70">
                          {MONTHS[(q - 1) * 3]}–{MONTHS[(q - 1) * 3 + 2]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-1">
              {fiscalYears.length === 0 ? (
                <p className="col-span-3 py-3 text-center text-[12px] text-mute">No fiscal year is set up yet.</p>
              ) : (
                fiscalYears.map((fy, offset) => (
                  <button
                    key={fy.label}
                    type="button"
                    aria-pressed={isCurrent("annual", offset)}
                    onClick={() => go("annual", offset)}
                    className={cell(isCurrent("annual", offset), false)}
                  >
                    {fy.label}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
