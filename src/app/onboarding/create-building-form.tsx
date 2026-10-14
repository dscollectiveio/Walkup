"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { AddressField } from "@/components/auth/address-field";
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

      <AddressField
        onPick={(a) => {
          // The short name is usually the street address: offer it, never overwrite.
          const el = document.getElementById("display_name") as HTMLInputElement | null;
          if (el && el.value.trim() === "") {
            el.value = a.street.replace(/^(\d+)\s+/, "$1 ");
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }}
      />

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
