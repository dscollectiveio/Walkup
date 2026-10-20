"use client";

import { useActionState, useState } from "react";
import { createInvite } from "./actions";
import { btnPrimary } from "@/components/repairs/styles";

const ROLES = [
  { value: "board_admin", label: "Board admin: full read/write" },
  { value: "board_member", label: "Board member: full read, most write" },
  { value: "accountant", label: "Accountant: financials and tax, read-only, ends after 90 days" },
  { value: "property_manager", label: "Property manager: runs repairs, sees units and owners, read-only elsewhere, ends after 90 days" },
  { value: "attorney", label: "Attorney: only the legal documents you share with them, read-only, ends after 90 days" },
  { value: "observer", label: "Observer: sees what an owner sees plus the finances summary, read-only, ends after 90 days" },
  { value: "owner", label: "Owner: read-only, own unit" },
];

/** A board admin can invite any role; any other board member can invite owners only (0060). Every role but owner needs the invitee's email, and its link lasts 3 days (0075). */
export function GenerateInviteForm({
  people = [],
  canGiveAnyRole = false,
}: {
  people?: { id: string; full_name: string }[];
  canGiveAnyRole?: boolean;
}) {
  const roles = canGiveAnyRole ? ROLES : ROLES.filter((r) => r.value === "owner");
  const [role, setRole] = useState("");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createInvite, null);

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
        className={btnPrimary}
      >
        Generate an invite
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="invite_role" className="block text-[12px] font-medium text-ink">
            Role
          </label>
          <select
            id="invite_role"
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="" disabled>
              Choose…
            </option>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="invite_email" className="block text-[12px] font-medium text-ink">
            Email
            <span className="ml-1 font-normal text-mute-soft">
              {role && role !== "owner" ? "required: they must sign in with it" : "optional, just a label"}
            </span>
          </label>
          <input
            id="invite_email"
            name="email"
            type="email"
            required={role !== "" && role !== "owner"}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          />
        </div>
        {role === "owner" && people.length > 0 ? (
          <div className="sm:col-span-2">
            <label htmlFor="invite_person" className="block text-[12px] font-medium text-ink">
              Person
              <span className="ml-1 font-normal text-mute-soft">link to someone already in your list, or leave blank to create a new person</span>
            </label>
            <select
              id="invite_person"
              name="person_id"
              defaultValue=""
              className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
            >
              <option value="">Create a new person</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
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
          className={btnPrimary}
        >
          {pending ? "Creating…" : "Create invite link"}
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
