"use client";

import { useState } from "react";
import { HEADER_BUTTON } from "@/components/ui";
import { AddPersonForm } from "./add-person-form";
import { UnitsRoster, type RosterUnit } from "./units-roster";
import { AddUnitForm } from "./add-unit-form";

const primary = "rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid";
const active = "rounded-md border border-ink bg-paper px-4 py-2 text-[13px] font-medium text-ink";

/**
 * The Units and people card: its navy header carries "Add a unit" on the right,
 * and the form opens at the top of the card body. People are added from inside
 * a unit (its expanded card) or, for someone not in a unit, from Others on file.
 * The roster itself is server-rendered and passed in as children.
 */
export function UnitsCard({
  canAdd,
  people,
  canEditRoles,
  canDelete,
  roster,
  initialOpenId = null,
  children,
}: {
  canAdd: boolean;
  people: { id: string; full_name: string }[];
  canEditRoles: boolean;
  canDelete: boolean;
  roster: RosterUnit[];
  /** A unit to open on arrival (from the Dashboard building or a Collections link). */
  initialOpenId?: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // One unit open at a time: opening another closes the one that was open.
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  return (
    <section id="units-and-people" className="scroll-mt-20 rounded-xl border border-line bg-paper">
      <header className="rounded-t-[7px] band bg-ink px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="eyebrow text-paper">Units and people</h2>
            <p className="mt-1.5 text-[13px] text-ondark-mute">
              Every unit, who is in it, who owns what share, and who has been invited to sign in.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canAdd ? (
              <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={HEADER_BUTTON}>
                {open ? "Close" : "Add a unit"}
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <div className="space-y-5 px-5 py-4">
        {open ? <AddUnitForm people={people} canEditRoles={canEditRoles} onClose={() => setOpen(false)} /> : null}
        {roster.length > 0 ? (
          <UnitsRoster
            units={roster}
            open={new Set(openId ? [openId] : [])}
            onToggle={(id) => setOpenId((current) => (current === id ? null : id))}
            onOpen={(id) => setOpenId(id)}
            people={people}
            canEdit={canAdd}
            canDelete={canDelete}
            canEditRoles={canEditRoles}
          />
        ) : null}
        {children}
      </div>
    </section>
  );
}

/** Adds someone who is not in a unit (a board member or accountant). */
export function AddOtherPerson({ canEditRoles }: { canEditRoles: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={open ? active : primary}>
        Add someone not in a unit
      </button>
      {open ? <AddPersonForm units={[]} canEditRoles={canEditRoles} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
