"use client";

import { useActionState, useState } from "react";
import { updateAssociationProfile } from "./actions";

export interface AssociationProfile {
  legal_name: string;
  display_name: string;
  state_code: string;
  county: string | null;
  city: string | null;
  ein: string | null;
  incorporated_on: string | null;
  fiscal_year_end_month: number;
  capitalization_threshold: number;
  capitalization_threshold_source: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Whole-record edit, generalizing the reserve-target card's open/close
 * pattern to several fields at once. board_admin-only — the caller decides
 * whether to render this at all. */
export function AssociationProfileForm({ profile }: { profile: AssociationProfile }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateAssociationProfile, null);

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
        className="rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
      >
        Edit details
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="legal_name" className="block text-[12px] font-medium text-ink">
            Legal name
          </label>
          <input
            id="legal_name"
            name="legal_name"
            required
            defaultValue={profile.legal_name}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="display_name" className="block text-[12px] font-medium text-ink">
            Display name
          </label>
          <input
            id="display_name"
            name="display_name"
            required
            defaultValue={profile.display_name}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>

        <div>
          <label htmlFor="state_code" className="block text-[12px] font-medium text-ink">
            State
          </label>
          <input
            id="state_code"
            name="state_code"
            required
            maxLength={2}
            placeholder="IL"
            defaultValue={profile.state_code}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] uppercase text-ink"
          />
        </div>
        <div>
          <label htmlFor="county" className="block text-[12px] font-medium text-ink">
            County
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="county"
            name="county"
            defaultValue={profile.county ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>

        <div>
          <label htmlFor="city" className="block text-[12px] font-medium text-ink">
            City
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="city"
            name="city"
            defaultValue={profile.city ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="ein" className="block text-[12px] font-medium text-ink">
            EIN
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="ein"
            name="ein"
            placeholder="00-0000000"
            defaultValue={profile.ein ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>

        <div>
          <label htmlFor="incorporated_on" className="block text-[12px] font-medium text-ink">
            Incorporated on
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="incorporated_on"
            name="incorporated_on"
            type="date"
            defaultValue={profile.incorporated_on ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="fiscal_year_end_month" className="block text-[12px] font-medium text-ink">
            Fiscal year ends
          </label>
          <select
            id="fiscal_year_end_month"
            name="fiscal_year_end_month"
            defaultValue={String(profile.fiscal_year_end_month)}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="capitalization_threshold" className="block text-[12px] font-medium text-ink">
            Capitalization threshold
          </label>
          <input
            id="capitalization_threshold"
            name="capitalization_threshold"
            type="number"
            min="0"
            step="0.01"
            defaultValue={profile.capitalization_threshold}
            className="figures mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="capitalization_threshold_source" className="block text-[12px] font-medium text-ink">
            Threshold source
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="capitalization_threshold_source"
            name="capitalization_threshold_source"
            defaultValue={profile.capitalization_threshold_source ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
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
          {pending ? "Saving…" : "Save"}
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
