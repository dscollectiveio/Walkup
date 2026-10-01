"use client";

import { useRouter } from "next/navigation";
import { statementHref, type PeriodGrain } from "./periods";
import type { PeriodOption } from "./summary";

/**
 * One dropdown for months, quarters and fiscal years. Picking an option
 * navigates; the page re-renders on the server with the new period.
 */
export function PeriodPicker({
  options,
  current,
  currentLabel,
  sort,
}: {
  options: PeriodOption[];
  current: { period: PeriodGrain; offset: number };
  currentLabel: string | null;
  sort: "account" | "size";
}) {
  const router = useRouter();
  const key = (p: PeriodGrain, o: number) => `${p}:${o}`;
  const currentKey = key(current.period, current.offset);
  const listed = options.some((o) => key(o.period, o.offset) === currentKey);
  const groups: PeriodOption["group"][] = ["Months", "Quarters", "Years"];

  return (
    <select
      aria-label="Period"
      value={currentKey}
      onChange={(e) => {
        const [period, offset] = e.target.value.split(":");
        router.push(
          statementHref("/financial-statements", "total", period as PeriodGrain, Number(offset), {
            sort: sort === "size" ? "size" : undefined,
          }),
        );
      }}
      className="figures h-9 min-w-[11rem] rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
    >
      {!listed && currentLabel ? <option value={currentKey}>{currentLabel}</option> : null}
      {groups.map((g) => {
        const items = options.filter((o) => o.group === g);
        if (items.length === 0) return null;
        return (
          <optgroup key={g} label={g}>
            {items.map((o) => (
              <option key={key(o.period, o.offset)} value={key(o.period, o.offset)}>
                {o.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
