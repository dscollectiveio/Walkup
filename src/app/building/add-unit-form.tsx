"use client";

import { useActionState, useState } from "react";
import { addUnitWithPerson } from "./actions";
import { PeopleFields } from "./people-fields";
import { UnitFields } from "./unit-fields";
import { SECTION_HEADER } from "./section-header";
import { btnPrimary } from "@/components/repairs/styles";

/**
 * Adds a unit and everyone in it in one step: the unit's details, then any
 * number of people (new, with their contact details and role in the HOA, or
 * already on file), or no one yet.
 */
export function AddUnitForm({
  people,
  canEditRoles,
  onClose,
}: {
  /** People already on file, for "someone already on file". */
  people: { id: string; full_name: string }[];
  /** Only a board admin can give a role; others add the person without one. */
  canEditRoles: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(addUnitWithPerson, null);

  // Close only on a *new* successful submission, not merely because `state`
  // is still truthy from the last time this form was open (useActionState's
  // state outlives the toggle: comparing against the previous value during
  // render is the React-recommended way to react to that without an effect).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state && "ok" in state && state.ok) onClose();
  }

  return (
    <form action={action} className="space-y-6 rounded-xl border border-line bg-paper p-5">
      <section className="overflow-hidden rounded-lg border border-line">
        <h4 className={SECTION_HEADER}>The unit</h4>
        <div className="p-4">
          <UnitFields idPrefix="new-unit" />
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line">
        <h4 className={SECTION_HEADER}>People in this unit</h4>
        <div className="p-4">
          <PeopleFields idPrefix="new-unit" people={people} canEditRoles={canEditRoles} startWithNew />
        </div>
      </section>

      {state && "error" in state && state.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "Saving…" : "Add it"}
        </button>
        <button type="button" onClick={onClose} className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill">
          Cancel
        </button>
      </div>
    </form>
  );
}
