"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";

/** The fiscal year as a dropdown: an association can have ten or more years of records. */
export function FiscalYearSelect({ current, years }: { current: string; years: { id: string; label: string }[] }) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-[12px] font-medium text-ink">
        Fiscal year
      </label>
      <select
        id={id}
        value={current}
        onChange={(e) => router.push(`/tax?fy=${e.target.value}`)}
        className="min-h-[36px] min-w-[10rem] rounded-lg border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[13px]"
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.label}
          </option>
        ))}
      </select>
    </div>
  );
}
