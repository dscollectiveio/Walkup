"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { statementHref } from "./periods";
import {
  QUICK_PICKS,
  booksStartIdx,
  comparePeriod,
  defaultColumns,
  idxOfIso,
  keyOf,
  monthName,
  monthOf,
  monthsIn,
  parseKey,
  quickPickRange,
  rangeName,
  rangeSpan,
  yearOf,
  type CompareWith,
  type MonthIdx,
  type MonthRange,
  type PickerState,
  type QuickPick,
} from "./range";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Field = "from" | "to" | "from2" | "to2";

const COMPARE_OPTIONS: { id: CompareWith; label: string }[] = [
  { id: "ly", label: "Same months last year" },
  { id: "prev", label: "The months just before" },
  { id: "pick", label: "Pick months…" },
];

/**
 * Two ways to choose what the statement shows: a date range (start month to end month,
 * optionally a column per month) or a comparison of two periods. Whole months only.
 */
export function PeriodPicker({
  state,
  fiscalYears,
  today,
}: {
  /** What the page is showing now; the picker opens on the mode that produced it. */
  state: PickerState;
  fiscalYears: { label: string; starts_on: string; ends_on: string }[];
  /** "YYYY-MM-DD", from the server so the grid never disagrees with the page. */
  today: string;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const now = idxOfIso(today);
  const min = booksStartIdx(fiscalYears) ?? now - 11;
  const fy = fiscalYears as { label: string; starts_on: string; ends_on: string }[];

  const fromState = (s: PickerState) => ({
    from: parseKey(s.from) ?? now,
    to: parseKey(s.to) ?? now,
    from2: parseKey(s.from2) ?? now - 12,
    to2: parseKey(s.to2) ?? now - 12,
  });

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"range" | "compare">(state.mode);
  const [p, setP] = useState(() => fromState(state));
  const [colsTouched, setColsTouched] = useState<boolean | null>(null);
  const [colsChecked, setColsChecked] = useState(state.cols);
  const [withMode, setWithMode] = useState<CompareWith>(state.with);
  const [active, setActive] = useState<Field>("from");
  const [focusIdx, setFocusIdx] = useState<MonthIdx>(now);

  const p1: MonthRange = { from: p.from, to: p.to };
  const p2: MonthRange = comparePeriod(p1, withMode, withMode === "pick" ? { from: p.from2, to: p.to2 } : null);
  const n = monthsIn(p1);
  const cols = colsTouched === null ? defaultColumns(n) : colsChecked;

  // The button names what the page shows, not the draft being edited.
  const shown = fromState(state);
  const shownRange: MonthRange = { from: shown.from, to: shown.to };
  const label =
    state.mode === "compare"
      ? `${rangeName(shownRange)} vs. ${rangeName(comparePeriod(shownRange, state.with, { from: shown.from2, to: shown.to2 }))}`
      : state.pick
        ? (QUICK_PICKS.find((q) => q.id === state.pick)?.label ?? rangeSpan(shownRange))
        : rangeSpan(shownRange);

  const reset = () => {
    setMode(state.mode);
    setP(fromState(state));
    setColsTouched(null);
    setColsChecked(state.cols);
    setWithMode(state.with);
    setActive("from");
    setFocusIdx(fromState(state).from);
  };

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

  const go = (extra: Record<string, string | undefined>, offset = 0) => {
    setOpen(false);
    router.push(statementHref("/financial-statements", "total", "monthly", offset, extra));
  };

  const showRange = (r: MonthRange, c: boolean, pick?: QuickPick) => {
    if (r.from === r.to) return go({ pick }, now - r.from);
    return go({ from: keyOf(r.from), to: keyOf(r.to), cols: c ? "1" : "0", pick });
  };

  const apply = () => {
    if (mode === "range") return showRange(p1, cols);
    go({
      from: keyOf(p1.from),
      to: keyOf(p1.to),
      cmp: withMode,
      ...(withMode === "pick" ? { from2: keyOf(p2.from), to2: keyOf(p2.to) } : {}),
    });
  };

  // Clicking a field makes it the one the next grid click fills.
  const editsPeriod2 = mode === "compare" && (active === "from2" || active === "to2");
  const clickMonth = (m: MonthIdx) => {
    setFocusIdx(m);
    setP((cur) => {
      const next = { ...cur };
      if (active === "from") {
        next.from = m;
        next.to = m;
      } else if (active === "to") {
        next.to = m;
        if (next.to < next.from) [next.from, next.to] = [next.to, next.from];
      } else if (active === "from2") {
        next.from2 = m;
        next.to2 = m;
      } else {
        next.to2 = m;
        if (next.to2 < next.from2) [next.from2, next.to2] = [next.to2, next.from2];
      }
      return next;
    });
    setActive((a) => (a === "from" ? "to" : a === "to" ? "from" : a === "from2" ? "to2" : "from2"));
  };

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = yearOf(now); y >= yearOf(min); y--) ys.push(y);
    return ys;
  }, [now, min]);
  const available = (m: MonthIdx) => m >= min && m <= now;

  const onGridKey = (e: React.KeyboardEvent, m: MonthIdx) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -12 : e.key === "ArrowDown" ? 12 : 0;
    if (!step) return;
    e.preventDefault();
    // Up goes to the year above (later), so the keys follow the screen: rows run newest first.
    const target = Math.abs(step) === 12 ? m - step : m + step;
    if (!available(target)) return;
    setFocusIdx(target);
    cellRefs.current.get(target)?.focus();
  };

  const field = (id: Field, text: string, value: MonthIdx, disabled = false) => (
    <button
      type="button"
      key={id}
      disabled={disabled}
      aria-pressed={active === id}
      aria-label={`${text}: ${monthName(value)}`}
      onClick={() => {
        setActive(id);
        setFocusIdx(value);
      }}
      className={`flex h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-md border border-line-strong bg-paper px-3 text-left sm:h-10 ${
        active === id ? "outline outline-2 outline-offset-0 outline-brass" : ""
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-mute">{text}</span>
      <span className="figures text-[13px] font-medium text-ink">{monthName(value)}</span>
    </button>
  );

  const inP1 = (m: MonthIdx) => m >= p1.from && m <= p1.to;
  const inP2 = (m: MonthIdx) => mode === "compare" && m >= p2.from && m <= p2.to;
  const cell = (m: MonthIdx) => {
    const ok = available(m);
    const end1 = m === p1.from || m === p1.to;
    const cls = !ok
      ? "cursor-not-allowed text-mute-soft opacity-40"
      : inP1(m)
        ? end1
          ? "bg-ink text-paper"
          : "bg-ink/15 text-ink"
        : inP2(m)
          ? "bg-[var(--w-gold-tint)] text-ink"
          : "text-ink hover:bg-fill";
    return (
      <button
        key={m}
        type="button"
        disabled={!ok}
        ref={(el) => {
          if (el) cellRefs.current.set(m, el);
          else cellRefs.current.delete(m);
        }}
        tabIndex={m === Math.min(Math.max(focusIdx, min), now) ? 0 : -1}
        aria-pressed={inP1(m) || inP2(m)}
        aria-label={monthName(m)}
        onClick={() => clickMonth(m)}
        onKeyDown={(e) => onGridKey(e, m)}
        className={`h-11 rounded-md text-[12px] font-medium transition-colors sm:h-9 ${cls}`}
      >
        {MONTHS[monthOf(m)]}
      </button>
    );
  };

  const p2Words = monthsIn(p2) === 1 ? monthName(p2.from) : `${monthName(p2.from)} to ${monthName(p2.to)}`;
  const p2Message =
    p2.to < min
      ? `No posted data for ${rangeName(p2)}`
      : p2.from < min
        ? `Posted data for ${rangeName(p2)} starts ${monthName(min)}`
        : null;

  const summary =
    mode === "range"
      ? `${monthName(p1.from)} to ${monthName(p1.to)} · ${n} month${n === 1 ? "" : "s"}`
      : `${rangeName(p1)} vs. ${rangeName(p2)}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) reset();
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-11 min-w-[12rem] items-center justify-between gap-2 rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass sm:h-9"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-mute" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-20 bg-black/30 sm:hidden" aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Choose what to show"
            className="fixed inset-x-0 bottom-0 z-30 max-h-[90vh] overflow-y-auto rounded-t-2xl border border-line bg-paper shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1.5 sm:max-h-none sm:w-[34rem] sm:rounded-xl"
          >
            <div className="space-y-3 border-b border-line px-4 py-3">
              <div role="radiogroup" aria-label="What to show" className="grid grid-cols-2 gap-1 rounded-lg bg-fill p-1">
                {(
                  [
                    ["range", "Date range"],
                    ["compare", "Compare"],
                  ] as const
                ).map(([id, text]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={mode === id}
                    onClick={() => {
                      setMode(id);
                      setActive("from");
                    }}
                    className={`h-11 rounded-md text-[13px] font-medium sm:h-8 ${
                      mode === id ? "bg-paper text-ink shadow-sm" : "text-mute hover:text-ink"
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>

              {mode === "range" ? (
                <div className="flex flex-wrap gap-1.5" aria-label="Quick picks" role="group">
                  {QUICK_PICKS.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        const r = quickPickRange(q.id, today, fy as never, min);
                        showRange(r, defaultColumns(monthsIn(r)), q.id);
                      }}
                      className="h-11 rounded-full border border-line px-3 text-[12px] font-medium text-mute transition-colors hover:border-line-strong hover:text-ink sm:h-7 sm:px-2.5 sm:text-[11px]"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div>
                {mode === "compare" ? (
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-mute">Period 1</p>
                ) : null}
                <div className="flex gap-2">
                  {field("from", "From", p.from)}
                  {field("to", "To", p.to)}
                </div>
              </div>

              {mode === "compare" ? (
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-medium uppercase tracking-[0.07em] text-mute" htmlFor="compare-with">
                    Compare with
                  </label>
                  <select
                    id="compare-with"
                    value={withMode}
                    onChange={(e) => {
                      setWithMode(e.target.value as CompareWith);
                      if (e.target.value === "pick") setActive("from2");
                      else setActive("from");
                    }}
                    className="h-11 w-full rounded-md border border-line-strong bg-paper px-3 text-[13px] text-ink sm:h-10"
                  >
                    {COMPARE_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[12px] text-mute sm:text-[11px]">{p2Words}</p>
                  {withMode === "pick" ? (
                    <div className="flex gap-2 pt-1">
                      {field("from2", "From", p.from2)}
                      {field("to2", "To", p.to2)}
                    </div>
                  ) : null}
                  {p2Message ? <p className="text-[12px] font-medium text-warning-text sm:text-[11px]">{p2Message}</p> : null}
                </div>
              ) : null}
            </div>

            <div className="px-4 py-3">
              <div className="max-h-[34vh] space-y-1.5 overflow-y-auto sm:max-h-[18rem]" role="group" aria-label="Months">
                {years.map((y) => (
                  <div key={y} className="grid grid-cols-[2.75rem_1fr] items-center gap-2">
                    <span className="figures text-[12px] font-medium text-mute">{y}</span>
                    <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
                      {MONTHS.map((_, i) => cell(y * 12 + i))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-mute sm:text-[11px]">
                {editsPeriod2 ? "Click a start month, then an end month for Period 2." : "Click a start month, then an end month."}
              </p>
              {mode === "range" ? (
                <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[13px] text-ink sm:min-h-0">
                  <input
                    type="checkbox"
                    checked={cols}
                    onChange={(e) => {
                      setColsTouched(true);
                      setColsChecked(e.target.checked);
                    }}
                    className="h-4 w-4 accent-[var(--color-ink)]"
                  />
                  Show each month as a column
                </label>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
              <p className="min-w-0 truncate text-[13px] font-medium text-ink">{summary}</p>
              <button
                type="button"
                onClick={apply}
                className="h-11 rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid sm:h-9"
              >
                {mode === "range" ? "Show" : "Compare"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
