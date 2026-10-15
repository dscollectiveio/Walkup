"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { monthYear, moneyText } from "@/lib/repairs/format";
import { updateRates } from "../vendor-actions";

/**
 * "Rates and terms" (repairs-spec §10.2 item 3): what they quoted the
 * board, so the next board can compare. The date moves to today only when a
 * rate changes (updateRates decides).
 */
export function RatesCard(props: {
  vendorId: string;
  hourly: string | null;
  tripFee: string | null;
  afterHours: string | null;
  asOf: string | null;
  paymentMethods: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const fid = useId();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    hourly: props.hourly ?? "",
    tripFee: props.tripFee ?? "",
    afterHours: props.afterHours ?? "",
    paymentMethods: props.paymentMethods ?? "",
  });
  const any = props.hourly || props.tripFee || props.afterHours;

  if (editing) {
    const field = (key: "hourly" | "tripFee" | "afterHours", label: string) => (
      <div>
        <label htmlFor={`${fid}-${key}`} className={labelClass}>
          {label}
        </label>
        <input
          id={`${fid}-${key}`}
          inputMode="decimal"
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          placeholder="$"
          className={`figures ${inputClass}`}
        />
      </div>
    );
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await updateRates(props.vendorId, {
              hourly: form.hourly.trim() || null,
              tripFee: form.tripFee.trim() || null,
              afterHours: form.afterHours.trim() || null,
              paymentMethods: form.paymentMethods.trim() || null,
            });
            if ("error" in r) setError(r.error);
            else {
              setEditing(false);
              router.refresh();
            }
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {field("hourly", "Hourly")}
          {field("tripFee", "Trip or service-call fee")}
          {field("afterHours", "After hours")}
        </div>
        <div>
          <label htmlFor={`${fid}-pay`} className={labelClass}>
            Payment methods
          </label>
          <input
            id={`${fid}-pay`}
            value={form.paymentMethods}
            maxLength={120}
            onChange={(e) => setForm({ ...form, paymentMethods: e.target.value })}
            placeholder="Check or Zelle"
            className={inputClass}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className={btnSecondary}>
            Cancel
          </button>
        </div>
        {error ? <p className={errorClass}>{error}</p> : null}
      </form>
    );
  }

  return (
    <div className="space-y-3 text-[13px]">
      {any ? (
        <div>
          <p className="font-medium text-ink">Rates you were quoted</p>
          <ul className="mt-1 space-y-0.5 text-ink">
            {props.hourly ? <li>Hourly {moneyText(props.hourly)}</li> : null}
            {props.tripFee ? <li>Trip or service-call fee {moneyText(props.tripFee)}</li> : null}
            {props.afterHours ? <li>After hours {moneyText(props.afterHours)}</li> : null}
          </ul>
          {props.asOf ? <p className="mt-1 text-[12px] text-mute">as of {monthYear(props.asOf)}</p> : null}
        </div>
      ) : (
        <p className="text-mute">No rates recorded. Add what they quoted you so the next board can compare.</p>
      )}
      {props.paymentMethods ? <p className="text-ink">Payment methods: {props.paymentMethods}</p> : null}
      {props.canEdit ? (
        <button type="button" onClick={() => setEditing(true)} className={btnSecondary}>
          {any || props.paymentMethods ? "Edit rates" : "Add rates"}
        </button>
      ) : null}
    </div>
  );
}
