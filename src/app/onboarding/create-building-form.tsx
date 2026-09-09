"use client";

import { useActionState } from "react";
import { createBuilding } from "./actions";

export function CreateBuildingForm() {
  const [state, action, pending] = useActionState(createBuilding, null);

  return (
    <form action={action} className="mt-8 space-y-4">
      <div>
        <label htmlFor="full_name" className="block text-[12px] font-medium text-ink">
          Your name
        </label>
        <input
          id="full_name"
          name="full_name"
          required
          className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        />
      </div>

      <div>
        <label htmlFor="legal_name" className="block text-[12px] font-medium text-ink">
          Legal name
          <span className="ml-1 font-normal text-mute-soft">exactly as registered</span>
        </label>
        <input
          id="legal_name"
          name="legal_name"
          required
          className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        />
      </div>

      <div>
        <label htmlFor="display_name" className="block text-[12px] font-medium text-ink">
          Display name
          <span className="ml-1 font-normal text-mute-soft">what shows in the app</span>
        </label>
        <input
          id="display_name"
          name="display_name"
          required
          className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        />
      </div>

      <div>
        <label htmlFor="state_code" className="block text-[12px] font-medium text-ink">
          State
        </label>
        <input
          id="state_code"
          name="state_code"
          placeholder="IL"
          maxLength={2}
          required
          className="mt-1 w-24 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] uppercase text-ink"
        />
      </div>

      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create building"}
      </button>
    </form>
  );
}
