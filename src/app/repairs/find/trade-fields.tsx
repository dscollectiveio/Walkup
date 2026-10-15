"use client";

import { useState } from "react";
import { inputClass, labelClass } from "@/components/repairs/styles";
import { SEARCHABLE_TRADES } from "@/lib/contractors/trades";

/**
 * The "Kind of work" select, with an "Other" choice at the end that opens a box
 * for the work in the board's own words. That text is what Walkup searches
 * Google for, so the box says what leaves the building.
 */
export function TradeFields({ current, phrase }: { current: string | null; phrase: string }) {
  const [trade, setTrade] = useState(current ?? "");
  return (
    <>
      <div className="flex-1">
        <label htmlFor="find-trade" className={labelClass}>
          Kind of work
        </label>
        <select id="find-trade" name="trade" value={trade} onChange={(e) => setTrade(e.target.value)} required className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {SEARCHABLE_TRADES.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.label}
            </option>
          ))}
          <option value="other">Other</option>
        </select>
      </div>
      {trade === "other" ? (
        <div className="flex-[2]">
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
    </>
  );
}
