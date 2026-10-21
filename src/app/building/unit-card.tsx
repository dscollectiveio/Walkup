"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteUnit, saveUnitAndPeople } from "./actions";
import { InviteToSignIn } from "./invite-to-sign-in";
import { PeopleFields, type ResidentValue } from "./people-fields";
import { unitTypeLabel } from "@/lib/building/unit-types";
import { AddPersonForm } from "./add-person-form";
import { UnitFields, specsLine, type UnitRecord } from "./unit-fields";
import { SECTION_HEADER } from "./section-header";
import { UnitDocumentsPanel } from "./unit-documents-panel";
import { BOARD_UNIT_DOCUMENT_COPY } from "@/lib/owner/unit-documents";

const ROLE_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  owner: "Owner",
};

/** Someone in the unit, as shown on the card. */
export interface Resident extends ResidentValue {
  /** Set when the person has no login and could be invited to sign in. */
  invite: { associationName: string; boardContactName: string | null } | null;
}

/**
 * One unit, everyone in it, and a single Edit that opens the unit's details
 * and every person's details, roles and who is in the unit in one form.
 */
export function UnitCard({
  unit,
  residents,
  people,
  share,
  canEdit,
  canDelete,
  canEditRoles,
  expanded,
  onToggle,
  onOpen,
  highlighted = false,
  onHover,
}: {
  unit: UnitRecord;
  residents: Resident[];
  people: { id: string; full_name: string }[];
  /** The unit's current ownership percentage, from the latest recorded split. */
  share: number | null;
  canEdit: boolean;
  canDelete: boolean;
  canEditRoles: boolean;
  /** Owned by the roster so Expand / Collapse can open every unit at once. */
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Lit while its floor (or this row) is hovered. */
  highlighted?: boolean;
  onHover?: (hovering: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fieldsHidden, setFieldsHidden] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(saveUnitAndPeople, null);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Close only on a *new* successful save: compare during render (see add-unit-form.tsx).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state && "ok" in state && state.ok) setEditing(false);
  }

  if (editing) {
    const formId = `edit-${unit.id}`;
    return (
      <li id={`unit-${unit.id}`} className="scroll-mt-24 overflow-hidden rounded-lg border border-line-strong">
        <div className="flex items-center gap-2 bg-fill px-3 py-1.5">
          <button
            type="button"
            onClick={() => setFieldsHidden((v) => !v)}
            aria-expanded={!fieldsHidden}
            aria-label={`${fieldsHidden ? "Expand" : "Collapse"} ${unit.label}`}
            className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 text-mute transition-transform ${fieldsHidden ? "" : "rotate-90"}`}>
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="shrink-0 text-[14px] font-bold text-ink">{unit.label}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-mute">Editing</span>
          </button>
          <button
            key="save"
            type="submit"
            form={formId}
            disabled={pending}
            className="inline-flex min-h-[28px] shrink-0 items-center rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="inline-flex min-h-[28px] shrink-0 items-center rounded-md border border-line-strong bg-paper px-3 text-[12px] text-ink hover:bg-fill"
          >
            Cancel
          </button>
        </div>
        <form id={formId} action={action} className={`space-y-5 bg-paper p-4 ${fieldsHidden ? "hidden" : ""}`}>
          <input type="hidden" name="unit_id" value={unit.id} />
          <section className="overflow-hidden rounded-lg border border-line">
            <h4 className={SECTION_HEADER}>The unit</h4>
            <div className="p-4">
              <UnitFields unit={unit} idPrefix={`u-${unit.id}`} />
            </div>
          </section>
          <section className="overflow-hidden rounded-lg border border-line">
            <h4 className={SECTION_HEADER}>People in this unit</h4>
            <div className="p-4">
              <PeopleFields
                idPrefix={`u-${unit.id}`}
                residents={residents}
                people={people}
                canEditRoles={canEditRoles}
              />
            </div>
          </section>
          {state && "error" in state && state.error ? (
            <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
          ) : null}
        </form>
        {fieldsHidden && state && "error" in state && state.error ? (
          <p className="border-t border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
        ) : null}
      </li>
    );
  }

  const ownerNames = residents.map((r) => r.fullName);
  return (
    <li
      id={`unit-${unit.id}`}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={`scroll-mt-24 overflow-hidden rounded-lg border transition-shadow ${
        highlighted ? "border-slate shadow-[0_0_0_2px_var(--color-slate)]" : "border-line"
      }`}
    >
      <div className="flex items-center gap-2 bg-fill px-3 py-1.5">
        <button
          type="button"
          onClick={() => onToggle()}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${unit.label}`}
          className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 text-mute transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="shrink-0 text-[14px] font-bold text-ink">{unit.label}</span>
          {unitTypeLabel(unit.unit_type) ? <span className="hidden shrink-0 text-[12px] text-mute sm:inline">{unitTypeLabel(unit.unit_type)}</span> : null}
          <span className={`min-w-0 flex-1 truncate text-[13px] ${ownerNames.length ? "text-ink" : "text-mute-soft"}`}>
            {ownerNames.length ? ownerNames.join(", ") : "No one yet"}
          </span>
          <span className="hidden shrink-0 text-[12px] text-mute md:inline">{specsLine(unit)}</span>
          {share !== null ? (
            <span
              title="This unit's ownership share"
              className="shrink-0 rounded-full border border-brass/40 bg-brass/20 px-2.5 py-0.5 text-[11px] font-semibold text-ink backdrop-blur-sm"
            >
              {`${+share.toFixed(2)}%`}
            </span>
          ) : null}
        </button>
        {canEdit ? (
          <button
            key="edit"
            type="button"
            onClick={() => {
              onOpen();
              setFieldsHidden(false);
              setEditing(true);
            }}
            className="inline-flex min-h-[28px] shrink-0 items-center rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid"
          >
            Edit
          </button>
        ) : null}
        <button
          key="toggle"
          type="button"
          onClick={() => onToggle()}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${unit.label} details`}
          className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
        >
          {expanded ? "Collapse" : "Expand"}
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {expanded ? (
        <>
          <p className="border-t border-line px-4 py-2 text-[12px] text-mute md:hidden">{specsLine(unit)}</p>
          {unit.notes ? (
            <p className="whitespace-pre-line border-t border-line px-4 py-2 text-[12px] text-mute">
              <span className="font-medium text-ink">Notes: </span>
              {unit.notes}
            </p>
          ) : null}
          {residents.length === 0 ? (
            <p className="border-t border-line px-4 py-3 text-[12px] text-mute">No one is in this unit yet.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line px-4">
              {residents.map((r) => (
                <li key={r.ownerRowId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">{r.fullName}</span>
                      {r.roles.map((role) => (
                        <span key={role} className="rounded-full border border-line bg-fill px-2 py-0.5 text-[10px] text-mute">
                          {ROLE_LABEL[role] ?? role}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-[12px] text-mute">{[r.email, r.phone].filter(Boolean).join(" · ") || "No contact info on file"}</div>
                    {r.mailingAddress ? <div className="text-[11px] text-mute-soft">{r.mailingAddress}</div> : null}
                  </div>
                  {r.invite ? (
                    <div className="ml-auto shrink-0">
                      <InviteToSignIn personId={r.personId} associationName={r.invite.associationName} boardContactName={r.invite.boardContactName} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <div className="space-y-2 border-t border-line px-4 py-3">
              <h4 className="text-[13px] font-bold text-ink">{BOARD_UNIT_DOCUMENT_COPY.sectionTitle}</h4>
              <UnitDocumentsPanel units={[{ id: unit.id, label: unit.label }]} unitId={unit.id} showList />
            </div>
          ) : null}

          {canEdit || canDelete ? (
            <div className="space-y-3 border-t border-line px-4 py-3">
              {addingPerson ? (
                <AddPersonForm
                  units={[]}
                  fixedUnit={{ id: unit.id, label: unit.label }}
                  canEditRoles={canEditRoles}
                  onClose={() => setAddingPerson(false)}
                />
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {canEdit && !addingPerson ? (
                  <button
                    type="button"
                    onClick={() => setAddingPerson(true)}
                    className="inline-flex min-h-[32px] items-center rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid"
                  >
                    Add a person
                  </button>
                ) : <span />}
                {canDelete ? (
                  confirming ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={deletePending}
                        onClick={() =>
                          startDelete(async () => {
                            setDeleteError(null);
                            const result = await deleteUnit(unit.id);
                            if (result.error) setDeleteError(result.error);
                            else setConfirming(false);
                          })
                        }
                        className="rounded-md border border-bad-line bg-bad-tint px-2.5 py-1 text-[11px] font-medium text-bad-text"
                      >
                        {deletePending ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button type="button" onClick={() => setConfirming(false)} className="text-[12px] text-mute underline-offset-2 hover:underline">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirming(true)} className="text-[12px] text-bad-text underline-offset-2 hover:underline">
                      Delete unit
                    </button>
                  )
                ) : null}
              </div>
              {deleteError ? <p className="text-[11px] text-bad-text">{deleteError}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}
