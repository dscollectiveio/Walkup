"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { statementHref, type PeriodGrain } from "./periods";
import { MAX_SELECTED, parseSelection, pickerBounds } from "./summary";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GRAINS: { key: PeriodGrain; label: string }[] = [
  { key: "monthly", label: "Months" },
  { key: "quarterly", label: "Quarters" },
  { key: "annual", label: "Years" },
];
const NOUN = { monthly: "month", quarterly: "quarter", annual: "year" } as const;

const grainOf = (k: string): PeriodGrain => (k.startsWith("FY:") ? "annual" : k.includes("Q") ? "quarterly" : "monthly");

/**
 * Choose one or several months, quarters or fiscal years.
 *
 * One button shows what's on screen. It opens a wide panel laid out like a
 * calendar: one row per year, a chip per month (or quarter), newest year on
 * top, so a run of periods reads left to right the way a board member thinks
 * about it. Click a chip to add or remove it; shift-click a second chip to
 * take everything in between. Quick picks on the top row cover the usual
 * asks (this month, last 3, year so far…). Nothing changes on the page until
 * "Show" — one pick is the ordinary statement, several become columns.
 */
export function PeriodPicker({
  label,
  grain: currentGrain,
  selectedKeys,
  fiscalYears,
  today,
  sort,
}: {
  label: string;
  grain: PeriodGrain;
  /** Keys of what's on screen now (see periodKeyFor). */
  selectedKeys: string[];
  fiscalYears: { label: string; starts_on: string }[];
  /** "YYYY-MM-DD", from the server so the grid never disagrees with the page. */
  today: string;
  sort: "account" | "size";
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [grain, setGrain] = useState<PeriodGrain>(currentGrain);
  const [draft, setDraft] = useState<string[]>(selectedKeys);
  const [anchor, setAnchor] = useState<string | null>(null);

  const bounds = pickerBounds(fiscalYears, today);
  const ty = Number(today.slice(0, 4));
  const years: number[] = [];
  for (let y = bounds.maxYear; y >= bounds.minYear; y--) years.push(y);

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

  // Every period that can be picked for this grain, oldest first. Ranges are slices of it.
  const monthAvailable = (y: number, i: number) => y * 12 + i >= bounds.minMonthIndex && y * 12 + i <= bounds.maxMonthIndex;
  const quarterAvailable = (y: number, q: number) => {
    const first = y * 12 + (q - 1) * 3;
    return first + 2 >= bounds.minMonthIndex && first <= bounds.maxMonthIndex;
  };
  const monthKey = (y: number, i: number) => `${y}-${String(i + 1).padStart(2, "0")}`;
  const quarterKey = (y: number, q: number) => `${y}-Q${q}`;
  const allKeys: (string | null)[] =
    grain === "monthly"
      ? [...years].reverse().flatMap((y) => MONTHS.map((_, i) => (monthAvailable(y, i) ? monthKey(y, i) : null)))
      : grain === "quarterly"
        ? [...years].reverse().flatMap((y) => [1, 2, 3, 4].map((q) => (quarterAvailable(y, q) ? quarterKey(y, q) : null)))
        : [...fiscalYears].reverse().map((fy) => `FY:${fy.label}`);
  const ordered = allKeys.filter((k): k is string => k !== null);

  const active = draft.filter((k) => grainOf(k) === grain);
  const full = active.length >= MAX_SELECTED;
  const sortKeys = (keys: string[]) => ordered.filter((k) => keys.includes(k));

  const pick = (key: string, shift: boolean) => {
    if (shift && anchor && anchor !== key) {
      const a = ordered.indexOf(anchor);
      const b = ordered.indexOf(key);
      if (a >= 0 && b >= 0) {
        const range = ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
        setDraft(sortKeys([...new Set([...active, ...range])]).slice(-MAX_SELECTED));
        return;
      }
    }
    setAnchor(key);
    setDraft(active.includes(key) ? active.filter((k) => k !== key) : full ? active : sortKeys([...active, key]));
  };

  const last = (n: number) => ordered.slice(-n);
  const presets: { label: string; keys: string[] }[] =
    grain === "monthly"
      ? [
          { label: "This month", keys: last(1) },
          { label: "Last 3 months", keys: last(3) },
          { label: "Last 6 months", keys: last(6) },
          { label: "Last 12 months", keys: last(12) },
          { label: `${ty} so far`, keys: ordered.filter((k) => k.startsWith(`${ty}-`)) },
        ]
      : grain === "quarterly"
        ? [
            { label: "This quarter", keys: last(1) },
            { label: "Last 4 quarters", keys: last(4) },
            { label: `${ty} so far`, keys: ordered.filter((k) => k.startsWith(`${ty}-`)) },
          ]
        : [
            { label: "This year", keys: last(1) },
            { label: "Last 2 years", keys: last(2) },
            { label: "Last 3 years", keys: last(3) },
          ];
  const presetOn = (keys: string[]) => keys.length > 0 && keys.length === active.length && keys.every((k) => active.includes(k));

  const apply = () => {
    const extra = { sort: sort === "size" ? "size" : undefined };
    const sel = parseSelection(active.join(","), fiscalYears, today);
    if (!sel) return;
    setOpen(false);
    if (sel.items.length === 1) {
      router.push(statementHref("/financial-statements", "total", sel.grain, sel.items[0].offset, extra));
    } else {
      router.push(
        statementHref("/financial-statements", "total", "monthly", 0, {
          ...extra,
          periods: sel.items.map((i) => i.key).join(","),
        }),
      );
    }
  };

  const unchanged =
    grain === currentGrain && active.length === selectedKeys.length && selectedKeys.every((k) => active.includes(k));

  const summary = (() => {
    if (active.length === 0) return `Pick one or more ${NOUN[grain]}s`;
    const keys = sortKeys(active);
    const first = keys[0];
    const lastKey = keys[keys.length - 1];
    const run = ordered.slice(ordered.indexOf(first), ordered.indexOf(lastKey) + 1).length === keys.length;
    const name = (k: string) =>
      grain === "monthly"
        ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`
        : grain === "quarterly"
          ? `${k.slice(5)} ${k.slice(0, 4)}`
          : k.slice(3);
    const count = `${keys.length} ${NOUN[grain]}${keys.length === 1 ? "" : "s"}`;
    if (keys.length === 1) return name(first);
    return run ? `${name(first)} – ${name(lastKey)} · ${count}` : `${count} (not in a row)`;
  })();

  // A chip: selected = navy; the current period gets a thin ring so "now" is easy to find.
  const chip = (key: string | null, text: string, sub?: string) => {
    const on = key !== null && active.includes(key);
    const disabled = key === null || (!on && full);
    const isNow = key === ordered[ordered.length - 1];
    return (
      <button
        key={key ?? text}
        type="button"
        disabled={disabled}
        aria-pressed={on}
        onClick={(e) => key && pick(key, e.shiftKey)}
        className={`flex h-9 min-w-0 flex-col items-center justify-center rounded-md text-[12px] font-medium leading-tight transition-colors ${
          on
            ? "bg-ink text-paper"
            : key === null
              ? "cursor-default text-mute-soft opacity-30"
              : disabled
                ? "cursor-not-allowed text-mute-soft opacity-40"
                : "text-ink hover:bg-fill"
        } ${isNow && !on ? "ring-1 ring-inset ring-line-strong" : ""}`}
      >
        <span>{text}</span>
        {sub ? <span className="text-[9px] font-normal opacity-70">{sub}</span> : null}
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setGrain(currentGrain);
          setDraft(selectedKeys);
          setAnchor(null);
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-9 min-w-[12rem] items-center justify-between gap-2 rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-mute" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose periods"
          className="absolute left-0 top-full z-30 mt-1.5 w-[min(44rem,calc(100vw-2rem))] rounded-xl border border-line bg-paper shadow-lg"
        >
          {/* Top row: what kind of period, and the quick picks for it. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div role="tablist" aria-label="Period type" className="grid grid-cols-3 gap-1 rounded-lg bg-fill p-1">
              {GRAINS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={grain === g.key}
                  onClick={() => {
                    setGrain(g.key);
                    setAnchor(null);
                  }}
                  className={`h-7 rounded-md px-3 text-[12px] font-medium ${
                    grain === g.key ? "bg-paper text-ink shadow-sm" : "text-mute hover:text-ink"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {presets
                .filter((p) => p.keys.length > 0)
                .map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={presetOn(p.keys)}
                    onClick={() => {
                      setDraft(p.keys);
                      setAnchor(null);
                    }}
                    className={`h-7 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                      presetOn(p.keys)
                        ? "border-ink bg-ink text-paper"
                        : "border-line text-mute hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
            </div>
          </div>

          {/* The calendar: a row per year, newest on top. */}
          <div className="max-h-[22rem] overflow-y-auto px-4 py-3">
            {grain === "annual" ? (
              fiscalYears.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-mute">No fiscal year is set up yet.</p>
              ) : (
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                  {[...fiscalYears].reverse().map((fy) => chip(`FY:${fy.label}`, fy.label))}
                </div>
              )
            ) : (
              <div className="space-y-1.5">
                {years.map((y) => (
                  <div key={y} className="grid grid-cols-[3rem_1fr] items-center gap-2">
                    <span className="figures text-[12px] font-medium text-mute">{y}</span>
                    {grain === "monthly" ? (
                      <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
                        {MONTHS.map((m, i) => chip(monthAvailable(y, i) ? monthKey(y, i) : null, m))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((q) =>
                          chip(
                            quarterAvailable(y, q) ? quarterKey(y, q) : null,
                            `Q${q}`,
                            `${MONTHS[(q - 1) * 3]}–${MONTHS[(q - 1) * 3 + 2]}`,
                          ),
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom row: what's picked, and the one button that changes the page. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{summary}</p>
              <p className="text-[11px] text-mute">
                {full
                  ? `Up to ${MAX_SELECTED} at a time.`
                  : grain === "annual"
                    ? "Click to add or remove a year."
                    : "Click to add or remove · shift-click to pick a run."}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {active.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraft([]);
                    setAnchor(null);
                  }}
                  className="h-8 rounded-md px-2.5 text-[12px] font-medium text-mute hover:bg-fill hover:text-ink"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={apply}
                disabled={active.length === 0 || unchanged}
                className="h-8 rounded-md bg-ink px-3.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-40"
              >
                {active.length > 1 ? `Compare ${active.length} ${NOUN[grain]}s` : "Show"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
