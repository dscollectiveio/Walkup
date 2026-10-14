"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { useActionState } from "react";
import { createBuilding } from "./actions";

export function CreateBuildingForm() {
  const [state, action, pending] = useActionState(createBuilding, null);

  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="full_name" className={authLabel}>
          Your name
        </label>
        <input
          id="full_name"
          name="full_name"
          autoComplete="name"
          required
          className={authInput}
        />
      </div>

      <div>
        <label htmlFor="legal_name" className={authLabel}>
          Association&rsquo;s legal name
          <span className="ml-1 font-normal text-mute-soft">as on the declaration</span>
        </label>
        <input
          id="legal_name"
          name="legal_name"
          required
          className={authInput}
        />
      </div>

      <div>
        <label htmlFor="display_name" className={authLabel}>
          Short name
          <span className="ml-1 font-normal text-mute-soft">what you&rsquo;ll see in the app, usually the address</span>
        </label>
        <input
          id="display_name"
          name="display_name"
          placeholder="2158 N. Damen"
          required
          className={authInput}
        />
      </div>

      <div>
        <label htmlFor="state_code" className={authLabel}>
          State
        </label>
        <input
          id="state_code"
          name="state_code"
          defaultValue="IL"
          maxLength={2}
          required
          className={`${authInput} w-24 uppercase`}
        />
        <p className="mt-1.5 text-[12px] text-mute">Walkup supports Illinois associations today.</p>
      </div>

      {state?.error ? (
        <p className={authError}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={authButton}
      >
        {pending ? "Setting up your building…" : "Create my building"}
      </button>
    </form>
  );
}
