"use client";

import { useActionState, useState } from "react";
import { addPerson } from "./actions";
import { PhoneInput } from "@/components/phone-input";
import { todayIso } from "@/lib/dates";
import { ROLE_OPTIONS } from "./person-row";

const input = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const label = "block text-[12px] font-medium text-ink";
const optional = <span className="ml-1 font-normal text-mute-soft">optional</span>;

/**
 * Adds a person: their details, their role in the HOA (board admins), and
 * optionally the unit they are in. Opened from the Add bar above the roster.
 */
export function AddPersonForm({
  units,
  fixedUnit,
  canEditRoles,
  onClose,
}: {
  units: { id: string; label: string }[];
  /** Adds the person to this unit: no unit picker, just the date they became the owner. */
  fixedUnit?: { id: string; label: string };
  canEditRoles: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(addPerson, null);
  const [unitId, setUnitId] = useState("");

  // Close only on a *new* successful submission: compare during render (see add-unit-form.tsx).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state && "ok" in state && state.ok) onClose();
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <h4 className="text-[13px] font-bold text-ink">Add a person</h4>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ap-name" className={label}>
            Full name
          </label>
          <input id="ap-name" name="full_name" required className={input} />
        </div>
        <div>
          <label htmlFor="ap-email" className={label}>
            Email{optional}
          </label>
          <input id="ap-email" name="email" type="email" className={input} />
        </div>
        <div>
          <label htmlFor="ap-phone" className={label}>
            Phone{optional}
          </label>
          <PhoneInput id="ap-phone" name="phone" className={input} />
        </div>
        <div>
          <label htmlFor="ap-addr" className={label}>
            Mailing address{optional}
          </label>
          <input id="ap-addr" name="mailing_address" className={input} />
        </div>
      </div>

      {canEditRoles ? (
        <div>
          <input type="hidden" name="roles_submitted" value="1" />
          <span className={label}>Role in the HOA</span>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {ROLE_OPTIONS.map((r) => (
              <label key={r.value} className="flex items-center gap-1.5 text-[12px] text-ink">
                <input type="checkbox" name="roles" value={r.value} className="rounded border-line-strong" />
                {r.label}
                <span className="text-mute-soft">({r.hint})</span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-mute">A board admin can give them a role once they are added.</p>
      )}

      {fixedUnit ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="unit_id" value={fixedUnit.id} />
          <div>
            <label htmlFor="ap-since" className={label}>
              Owner of {fixedUnit.label} since
            </label>
            <input id="ap-since" name="effective_from" type="date" defaultValue={todayIso()} className={input} />
          </div>
        </div>
      ) : units.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ap-unit" className={label}>
              Owner of a unit{optional}
            </label>
            <select id="ap-unit" name="unit_id" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={input}>
              <option value="">Not an owner of a unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          {unitId ? (
            <div>
              <label htmlFor="ap-since" className={label}>
                Owner since
              </label>
              <input id="ap-since" name="effective_from" type="date" defaultValue={todayIso()} className={input} />
            </div>
          ) : null}
        </div>
      ) : null}

      {state && "error" in state && state.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add them"}
        </button>
        <button type="button" onClick={onClose} className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill">
          Cancel
        </button>
      </div>
    </form>
  );
}
