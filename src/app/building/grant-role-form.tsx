"use client";

import { useActionState, useState } from "react";
import { grantRole } from "./actions";

const ROLES = [
  { value: "board_admin", label: "Board admin — full read/write" },
  { value: "board_member", label: "Board member — full read, limited write" },
  { value: "accountant", label: "Accountant — financials, time-boxed" },
  { value: "owner", label: "Owner — read-only, own unit" },
];

export function GrantRoleForm({ persons }: { persons: { id: string; full_name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(grantRole, null);

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
        Grant a role
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="grant_person_id" className="block text-[12px] font-medium text-ink">
            Person
          </label>
          <select
            id="grant_person_id"
            name="person_id"
            required
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="" disabled>
              Choose…
            </option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="grant_role" className="block text-[12px] font-medium text-ink">
            Role
          </label>
          <select
            id="grant_role"
            name="role"
            required
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="" disabled>
              Choose…
            </option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="expires_on" className="block text-[12px] font-medium text-ink">
          Expires on
          <span className="ml-1 font-normal text-mute-soft">
            optional — accountants default to 90 days if left blank
          </span>
        </label>
        <input
          id="expires_on"
          name="expires_on"
          type="date"
          className="mt-1 w-full max-w-[200px] rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
        />
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
          {pending ? "Saving…" : "Grant it"}
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
