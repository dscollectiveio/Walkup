"use client";

import { useState, useTransition } from "react";
import { saveBudgetLine } from "./actions";

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(cents / 100),
  );

/**
 * The planned figure on a budget row, editable in place: click it, type the
 * annual amount, press Enter. Same set_budget_line path as the full editor.
 */
export function PlannedAmount({
  associationId,
  fiscalYearId,
  fundId,
  accountId,
  annualCents,
  suggestedAnnualCents,
  canEdit,
  label = "a year",
  openLabel,
}: {
  associationId: string;
  fiscalYearId: string;
  fundId: string;
  accountId: string;
  annualCents: number | null;
  /** Pre-filled when there's no budget yet — e.g. this year's spend, annualized. */
  suggestedAnnualCents?: number;
  canEdit: boolean;
  label?: string;
  /** Text of the button when nothing is budgeted yet. */
  openLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = () => {
    const cents = annualCents ?? suggestedAnnualCents ?? 0;
    setValue(cents > 0 ? String(cents / 100) : "");
    setError(null);
    setEditing(true);
  };

  if (!canEdit) {
    return annualCents !== null ? <span className="figures">{dollars(annualCents)}</span> : null;
  }

  const save = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("association_id", associationId);
      fd.set("fiscal_year_id", fiscalYearId);
      fd.set("account_id", accountId);
      fd.set("fund_id", fundId);
      fd.set("amount", value.replace(/[^0-9.]/g, ""));
      const result = await saveBudgetLine(null, fd);
      if (result?.error) setError(result.error);
      else setEditing(false);
    });

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        title={annualCents !== null ? `${dollars(annualCents)} ${label}: click to change` : "Set a budget for this category"}
        className="inline-flex min-h-[44px] items-center rounded px-1 underline decoration-dotted sm:min-h-0 decoration-line-strong underline-offset-4 hover:bg-fill hover:text-ink"
      >
        {annualCents !== null ? (
          <span className="figures">{dollars(annualCents)}</span>
        ) : (
          <span className="text-[12px] font-medium text-ink">{openLabel ?? "Set a budget"}</span>
        )}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-mute">$</span>
        <input
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label={`Budgeted amount ${label}`}
          disabled={pending}
          className="figures min-h-[44px] w-28 rounded-md border border-line-strong bg-paper py-1 pl-5 pr-2 text-right text-[16px] text-ink sm:min-h-0 sm:text-[13px]"
        />
      </span>
      <span className="text-[11px] text-mute">{label}</span>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="min-h-[44px] rounded-md bg-ink px-3 py-1 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50 sm:min-h-0 sm:px-2 sm:text-[11px]"
      >
        {pending ? "…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] px-2 text-[12px] text-mute hover:underline sm:min-h-0 sm:px-0 sm:text-[11px]">
        Cancel
      </button>
      {error ? <span className="w-full text-[11px] text-bad-text">{error}</span> : null}
    </span>
  );
}
