"use client";

import { useActionState, useState } from "react";
import { saveUnitDues } from "./actions";
import { FREQUENCY_WORDS, PLAN_FREQUENCIES, perPeriodCents } from "@/lib/dues/plan";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);

export interface UnitPlan {
  annualCents: number;
  frequency: (typeof PLAN_FREQUENCIES)[number];
  note: string | null;
}

/**
 * One unit's dues plan, edited in its own row: the yearly amount, how often
 * it's paid, and a note. Saving affects charges not yet posted — never one
 * already in the books.
 */
export function UnitDuesEditor({
  unitId,
  plan,
  canEdit,
}: {
  unitId: string;
  plan: UnitPlan | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [annual, setAnnual] = useState(plan ? String(plan.annualCents / 100) : "");
  const [frequency, setFrequency] = useState<UnitPlan["frequency"]>(plan?.frequency ?? "monthly");
  const [state, action, pending] = useActionState(saveUnitDues, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  const annualCents = Math.round((Number(annual) || 0) * 100);
  const preview = annualCents > 0 ? perPeriodCents(annualCents, frequency) : 0;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {plan ? (
          <span className="text-[13px]">
            <span className="figures text-ink">{money(plan.annualCents)}</span>
            <span className="text-mute"> a year · </span>
            <span className="figures text-ink">{money(perPeriodCents(plan.annualCents, plan.frequency))}</span>
            <span className="text-mute"> {FREQUENCY_WORDS[plan.frequency]}</span>
          </span>
        ) : (
          <span className="text-[12px] text-mute-soft">no plan yet</span>
        )}
        {plan?.note ? <span className="w-full text-[11px] text-mute-soft">{plan.note}</span> : null}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[12px] text-mute underline-offset-2 hover:text-ink hover:underline"
          >
            {plan ? "Change" : "Set dues"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-fill/40 p-2">
      <input type="hidden" name="unit_id" value={unitId} />
      <label className="block text-[11px] text-mute">
        A year
        <span className="relative mt-0.5 block">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-mute">$</span>
          <input
            name="annual_amount"
            inputMode="decimal"
            value={annual}
            onChange={(e) => setAnnual(e.target.value)}
            placeholder="5400"
            autoFocus
            className="figures h-8 w-28 rounded-md border border-line-strong bg-paper pl-5 pr-2 text-right text-[13px] text-ink"
          />
        </span>
      </label>
      <label className="block text-[11px] text-mute">
        Paid
        <select
          name="frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as UnitPlan["frequency"])}
          className="mt-0.5 block h-8 rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink"
        >
          {PLAN_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {FREQUENCY_WORDS[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-[10rem] flex-1 text-[11px] text-mute">
        Note <span className="text-mute-soft">(optional)</span>
        <input
          name="note"
          defaultValue={plan?.note ?? ""}
          placeholder="includes parking spot"
          className="mt-0.5 block h-8 w-full rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink"
        />
      </label>
      <span className="figures pb-1.5 text-[12px] text-mute">{preview > 0 ? `= ${money(preview)} ${FREQUENCY_WORDS[frequency]}` : ""}</span>
      <button
        type="submit"
        disabled={pending}
        className="h-8 rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-8 text-[12px] text-mute hover:underline">
        Cancel
      </button>
      {state?.error ? <span className="w-full text-[11px] text-bad-text">{state.error}</span> : null}
    </form>
  );
}
