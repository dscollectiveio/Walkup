"use client";

import { useActionState, useState } from "react";
import { btnPrimary, errorClass } from "@/components/repairs/styles";
import { startCheckout, type BillingActionState } from "@/app/billing/actions";

export interface PickerTier {
  key: string;
  name: string;
  minUnits: number;
  maxUnits: number;
  month: number;
  year: number;
}

const unitsWords = (t: PickerTier) => (t.minUnits <= 1 ? `Up to ${t.maxUnits} units` : `${t.minUnits} to ${t.maxUnits} units`);

/**
 * The three plans side by side with a monthly or yearly switch. A building's
 * plan is set by its unit count, so only the plan that fits can be chosen;
 * the others are shown so the price is never a surprise as the building
 * grows. Choosing opens Stripe's hosted checkout (startCheckout picks the tier
 * from the unit count again on the server).
 */
export function PlanPicker({
  tiers,
  fitKey,
  unitCount,
  canChoose,
  chargeNote,
}: {
  tiers: PickerTier[];
  fitKey: string | null;
  unitCount: number;
  /** False shows prices only: billing off, or not a board admin. */
  canChoose: boolean;
  /** When the first charge happens, in plain words. */
  chargeNote: string;
}) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [state, action, pending] = useActionState<BillingActionState | null, FormData>(startCheckout, null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-line bg-paper p-0.5">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors duration-300 ${
                interval === i ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {i === "month" ? "Monthly" : "Yearly"}
              {i === "year" ? (
                <span className={`rounded-full px-1.5 text-[11px] font-semibold ${interval === i ? "bg-brass text-on-brass" : "bg-fill text-mute"}`}>
                  2 months free
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-mute">
          You have {unitCount} {unitCount === 1 ? "unit" : "units"} on file.
        </p>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {tiers.map((t) => {
          const fits = t.key === fitKey;
          const price = interval === "month" ? t.month : t.year;
          return (
            <li
              key={t.key}
              className={`relative flex flex-col rounded-xl border p-4 transition-colors duration-300 ${
                fits ? "border-brass bg-paper ring-2 ring-brass/40" : "border-line bg-fill/40"
              }`}
            >
              {fits ? (
                <span className="absolute -top-2.5 left-4 rounded-full bg-brass px-2 py-0.5 text-[11px] font-bold text-on-brass">
                  Fits your building
                </span>
              ) : null}
              <p className={`text-[15px] font-bold ${fits ? "text-ink" : "text-mute"}`}>{t.name}</p>
              <p className="text-[12px] text-mute">{unitsWords(t)}</p>
              <p className="mt-3">
                <span className={`figures text-[28px] font-bold tracking-tight ${fits ? "text-ink" : "text-mute"}`}>${price}</span>
                <span className="text-[13px] text-mute"> / {interval === "month" ? "month" : "year"}</span>
              </p>
              <p className="min-h-[18px] text-[12px] text-mute">
                {interval === "year" ? `Instead of $${t.month * 12}. Save $${t.month * 12 - t.year}.` : `Or $${t.year} a year.`}
              </p>
              {fits && canChoose ? (
                <form action={action} className="mt-4">
                  <input type="hidden" name="interval" value={interval} />
                  <button type="submit" disabled={pending} className={`${btnPrimary} w-full justify-center`}>
                    {pending ? "Opening Stripe…" : `Choose ${t.name}`}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      {state?.error ? (
        <p role="alert" className={`${errorClass} mt-3`}>
          {state.error}
        </p>
      ) : null}
      {canChoose ? (
        <p className="mt-3 text-[12px] leading-relaxed text-mute">
          {chargeNote} Every plan includes every feature. You pay on Stripe&rsquo;s secure page, and Walkup never sees your card or bank
          numbers. Cancel any time.
        </p>
      ) : null}
    </div>
  );
}
