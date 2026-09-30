"use client";

import { useActionState, useState } from "react";
import { recordInsurancePolicy } from "./actions";

const COVERAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "property", label: "Building & property" },
  { value: "general_liability", label: "Public liability" },
  { value: "directors_officers", label: "Board members' liability (D&O)" },
  { value: "umbrella", label: "Umbrella (extra cover on top)" },
  { value: "flood", label: "Flood" },
  { value: "workers_comp", label: "Workers' compensation" },
  { value: "other", label: "Other" },
];

const inputClass = "mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink";

export function AddPolicyForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordInsurancePolicy, null);

  // Close only on a *new* successful submission — see add-unit-form.tsx.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
      >
        Record a policy
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <p className="text-[12px] text-mute">
        Copy this from the declarations page of the policy. One entry per policy.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="coverage" className="block text-[12px] font-medium text-ink">
            What it covers
          </label>
          <select id="coverage" name="coverage" required defaultValue="property" className={`${inputClass} bg-paper`}>
            {COVERAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="carrier_name" className="block text-[12px] font-medium text-ink">
            Insurer
          </label>
          <input id="carrier_name" name="carrier_name" required placeholder="West Bend" className={inputClass} />
        </div>

        <div>
          <label htmlFor="effective_from" className="block text-[12px] font-medium text-ink">
            Policy starts
          </label>
          <input id="effective_from" name="effective_from" type="date" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="effective_to" className="block text-[12px] font-medium text-ink">
            Policy ends
          </label>
          <input id="effective_to" name="effective_to" type="date" required className={inputClass} />
        </div>

        <div>
          <label htmlFor="annual_premium" className="block text-[12px] font-medium text-ink">
            Annual premium
          </label>
          <input
            id="annual_premium"
            name="annual_premium"
            type="number"
            min="0"
            step="0.01"
            required
            className={`figures ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="policy_number" className="block text-[12px] font-medium text-ink">
            Policy number
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input id="policy_number" name="policy_number" className={`figures ${inputClass}`} />
        </div>

        <div>
          <label htmlFor="deductible" className="block text-[12px] font-medium text-ink">
            Deductible
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input id="deductible" name="deductible" type="number" min="0" step="0.01" className={`figures ${inputClass}`} />
        </div>
        <div>
          <label htmlFor="coverage_limit" className="block text-[12px] font-medium text-ink">
            Coverage limit
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input id="coverage_limit" name="coverage_limit" type="number" min="0" step="0.01" className={`figures ${inputClass}`} />
        </div>

        <div>
          <label htmlFor="broker_name" className="block text-[12px] font-medium text-ink">
            Broker
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input id="broker_name" name="broker_name" className={inputClass} />
        </div>
        <div>
          <label htmlFor="broker_email" className="block text-[12px] font-medium text-ink">
            Broker email
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input id="broker_email" name="broker_email" type="email" className={inputClass} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="block text-[12px] font-medium text-ink">
            Notes
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input id="notes" name="notes" className={inputClass} />
        </div>
      </div>

      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save policy"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
