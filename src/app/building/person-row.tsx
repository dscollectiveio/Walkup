"use client";

import { useActionState, useState } from "react";
import { updatePerson } from "./actions";
import { PhoneInput } from "@/components/phone-input";

export interface PersonRecord {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  owner: "Owner",
};

export function PersonRow({
  person,
  roles,
  canEdit,
}: {
  person: PersonRecord;
  roles: string[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updatePerson, null);

  // Close only on a *new* successful submission — see add-unit-form.tsx.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-3">
        <form action={action} className="space-y-3">
          <input type="hidden" name="person_id" value={person.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`name-${person.id}`} className="block text-[12px] font-medium text-ink">
                Full name
              </label>
              <input
                id={`name-${person.id}`}
                name="full_name"
                required
                defaultValue={person.full_name}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`email-${person.id}`} className="block text-[12px] font-medium text-ink">
                Email
              </label>
              <input
                id={`email-${person.id}`}
                name="email"
                type="email"
                defaultValue={person.email ?? ""}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`phone-${person.id}`} className="block text-[12px] font-medium text-ink">
                Phone
              </label>
              <PhoneInput
                id={`phone-${person.id}`}
                name="phone"
                defaultValue={person.phone}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`addr-${person.id}`} className="block text-[12px] font-medium text-ink">
                Mailing address
              </label>
              <input
                id={`addr-${person.id}`}
                name="mailing_address"
                defaultValue={person.mailing_address ?? ""}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
          </div>
          {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink">{person.full_name}</span>
          {roles.map((r) => (
            <span
              key={r}
              className="rounded-full border border-line bg-fill px-2 py-0.5 text-[10px] text-mute"
            >
              {ROLE_LABEL[r] ?? r}
            </span>
          ))}
        </div>
        <div className="mt-1 text-[12px] text-mute">
          {[person.email, person.phone].filter(Boolean).join(" · ") || "No contact info on file"}
        </div>
        {person.mailing_address ? (
          <div className="text-[11px] text-mute-soft">{person.mailing_address}</div>
        ) : null}
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-[12px] text-mute underline-offset-2 hover:underline"
        >
          Edit
        </button>
      ) : null}
    </li>
  );
}
