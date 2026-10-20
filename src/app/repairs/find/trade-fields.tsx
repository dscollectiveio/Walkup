"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { inputClass, labelClass } from "@/components/repairs/styles";
import { SEARCHABLE_TRADES } from "@/lib/contractors/trades";

const bubble =
  "inline-flex min-h-[40px] cursor-pointer items-center rounded-full border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass";

/**
 * The "Kind of work" choice as bubbles: "Describe Scope of Work" first, then
 * each kind of work, two rows showing and the rest behind "Load more".
 * Describe Scope of Work opens a box for the work in the board's own words,
 * and those words are what Walkup searches Google for, so the box says what
 * leaves the building.
 */
/** Two rows of bubbles: each is 2.5rem tall with a 0.5rem gap. */
const TWO_ROWS_PX = 88;

export function TradeFields({ current, phrase }: { current: string | null; phrase: string }) {
  const [trade, setTrade] = useState(current ?? "");
  const [expanded, setExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // "Load more" shows only when the bubbles run past two rows. The observer's first callback gives the
  // starting measurement.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanCollapse(el.scrollHeight > TWO_ROWS_PX + 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Always starts condensed. The kind of work already chosen moves up beside "Describe Scope of Work"
  // so it stays in view without opening the list.
  const trades = [...SEARCHABLE_TRADES].sort((x, y) => Number(y.slug === current) - Number(x.slug === current));

  return (
    <div className="w-full space-y-3">
      <fieldset>
        <legend className={labelClass}>Kind of work</legend>
        <div className="relative mt-2">
        <div ref={box} className={`flex flex-wrap gap-2 ${canCollapse ? "pr-32" : ""} ${expanded ? "" : "max-h-[5.5rem] overflow-hidden"}`}>
          {/* First, set apart in gold: the one that opens a box to describe the work in your own words. */}
          <label className={`${bubble} !border-brass !bg-warning-tint font-semibold has-[:checked]:!bg-ink`}>
            <input type="radio" name="trade" value="other" checked={trade === "other"} onChange={() => setTrade("other")} required className="sr-only" />
            Describe Scope of Work
          </label>
          {trades.map((t) => (
            <label key={t.slug} className={bubble}>
              <input type="radio" name="trade" value={t.slug} checked={trade === t.slug} onChange={() => setTrade(t.slug)} required className="sr-only" />
              {t.label}
            </label>
          ))}
        </div>
        {canCollapse ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
            className="absolute bottom-0 right-0 inline-flex h-10 items-center gap-1 text-[13px] font-medium text-ink hover:text-ink-mid"
          >
            {expanded ? "Show fewer" : "Load more"}
            {expanded ? <ChevronUp size={15} strokeWidth={2.2} aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />}
          </button>
        ) : null}
        </div>
      </fieldset>
      {trade === "other" ? (
        <div className="max-w-xl">
          <label htmlFor="find-scope" className={labelClass}>
            What work do you need done?
          </label>
          <input
            id="find-scope"
            name="phrase"
            required
            maxLength={80}
            defaultValue={current === "other" ? phrase : ""}
            placeholder="Attic fan installation"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-mute">
            Walkup searches Google for these words near your building. Letters only, no names or numbers.
          </p>
        </div>
      ) : null}
    </div>
  );
}
