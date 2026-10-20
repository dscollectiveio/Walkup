"use client";

import { useRef, useState } from "react";
import { PhoneInput } from "@/components/phone-input";
import { AddressInput } from "@/components/address-input";
import { todayIso } from "@/lib/dates";
import { ROLE_OPTIONS } from "./person-row";

const input = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const label = "block text-[12px] font-medium text-ink";
const optional = <span className="ml-1 font-normal text-mute-soft">optional</span>;
const ghost = "rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid";

/** Someone already in the unit, with the values to edit. */
export interface ResidentValue {
  personId: string;
  ownerRowId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  mailingAddress: string | null;
  roles: string[];
}

type Added = { key: string; mode: "new" | "link" };

function RoleBoxes({ prefix, selected }: { prefix: string; selected: string[] }) {
  return (
    <div>
      <input type="hidden" name={`${prefix}.roles_submitted`} value="1" />
      <span className={label}>Role in the HOA</span>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {ROLE_OPTIONS.map((r) => (
          <label key={r.value} className="flex items-center gap-1.5 text-[12px] text-ink">
            <input type="checkbox" name={`${prefix}.roles`} value={r.value} defaultChecked={selected.includes(r.value)} className="rounded border-line-strong" />
            {r.label}
            <span className="text-mute-soft">({r.hint})</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * The "people in this unit" part of a unit form: every current resident
 * (editable, or marked to be removed), plus any number of new people or
 * people already on file. Field names are `p.<key>.<field>`, read on the
 * server by parsePeople (src/lib/building/unit-people.ts).
 */
export function PeopleFields({
  residents = [],
  people,
  canEditRoles,
  startWithNew = false,
  idPrefix,
}: {
  residents?: ResidentValue[];
  /** Everyone on file, for "someone already on file". */
  people: { id: string; full_name: string }[];
  /** Only a board admin can give a role. */
  canEditRoles: boolean;
  /** Start with one blank new person (adding a unit). */
  startWithNew?: boolean;
  idPrefix: string;
}) {
  const counter = useRef(startWithNew ? 1 : 0);
  const [added, setAdded] = useState<Added[]>(startWithNew ? [{ key: "n0", mode: "new" }] : []);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const toggleRemoved = (ownerRowId: string, on: boolean) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      if (on) next.add(ownerRowId);
      else next.delete(ownerRowId);
      return next;
    });
  const setMode = (key: string, mode: Added["mode"]) => setAdded((a) => a.map((x) => (x.key === key ? { ...x, mode } : x)));
  const addOne = () => {
    const key = `n${counter.current++}`;
    setAdded((a) => [...a, { key, mode: "new" }]);
  };

  const total = residents.length + added.length;

  return (
    <div className="space-y-3">
      {residents.map((r, i) => {
        const k = `r${i}`;
        const id = (n: string) => `${idPrefix}-${k}-${n}`;
        const gone = removed.has(r.ownerRowId);
        return (
          <div key={r.ownerRowId} className="space-y-3 rounded-lg border border-line bg-paper p-4">
            <input type="hidden" name={`p.${k}.owner_row_id`} value={r.ownerRowId} />
            <input type="hidden" name={`p.${k}.person_id`} value={r.personId} />
            {gone ? (
              <>
                <input type="hidden" name={`p.${k}.remove`} value="1" />
                <p className="text-[13px] text-ink">
                  <strong className="font-semibold">{r.fullName}</strong> will be taken off this unit when you save. They stay on file.{" "}
                  <button type="button" onClick={() => toggleRemoved(r.ownerRowId, false)} className="underline underline-offset-2">
                    Undo
                  </button>
                </p>
                <div className="max-w-[16rem]">
                  <label htmlFor={id("ended")} className={label}>
                    Left the unit on
                  </label>
                  <input id={id("ended")} name={`p.${k}.end_date`} type="date" defaultValue={todayIso()} className={input} />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={id("name")} className={label}>
                      Full name
                    </label>
                    <input id={id("name")} name={`p.${k}.full_name`} required defaultValue={r.fullName} className={input} />
                  </div>
                  <div>
                    <label htmlFor={id("email")} className={label}>
                      Email{optional}
                    </label>
                    <input id={id("email")} name={`p.${k}.email`} type="email" defaultValue={r.email ?? ""} className={input} />
                  </div>
                  <div>
                    <label htmlFor={id("phone")} className={label}>
                      Phone{optional}
                    </label>
                    <PhoneInput id={id("phone")} name={`p.${k}.phone`} defaultValue={r.phone} className={input} />
                  </div>
                  <div>
                    <label htmlFor={id("addr")} className={label}>
                      Mailing address{optional}
                    </label>
                    <AddressInput id={id("addr")} name={`p.${k}.mailing_address`} defaultValue={r.mailingAddress} className={input} />
                  </div>
                </div>
                {canEditRoles ? <RoleBoxes prefix={`p.${k}`} selected={r.roles} /> : null}
                <button type="button" onClick={() => toggleRemoved(r.ownerRowId, true)} className="text-[12px] text-bad-text underline-offset-2 hover:underline">
                  Take {r.fullName} off this unit
                </button>
              </>
            )}
          </div>
        );
      })}

      {added.map((a) => {
        const k = a.key;
        const id = (n: string) => `${idPrefix}-${k}-${n}`;
        return (
          <div key={k} className="space-y-3 rounded-lg border border-line bg-fill/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-x-5 gap-y-1" role="radiogroup" aria-label="Who is this">
                {(
                  [
                    ["new", "Someone new"],
                    ["link", "Someone already on file"],
                  ] as const
                ).map(([value, text]) => (
                  <label key={value} className="flex min-h-[32px] items-center gap-2 text-[13px] text-ink">
                    <input
                      type="radio"
                      name={`p.${k}.mode`}
                      value={value}
                      checked={a.mode === value}
                      onChange={() => setMode(k, value)}
                      className="h-4 w-4 accent-ink"
                    />
                    {text}
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => setAdded((x) => x.filter((y) => y.key !== k))} className="text-[12px] text-bad-text underline-offset-2 hover:underline">
                Remove
              </button>
            </div>

            {a.mode === "new" ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={id("name")} className={label}>
                      Full name
                    </label>
                    <input id={id("name")} name={`p.${k}.full_name`} required className={input} />
                  </div>
                  <div>
                    <label htmlFor={id("email")} className={label}>
                      Email{optional}
                    </label>
                    <input id={id("email")} name={`p.${k}.email`} type="email" className={input} />
                  </div>
                  <div>
                    <label htmlFor={id("phone")} className={label}>
                      Phone{optional}
                    </label>
                    <PhoneInput id={id("phone")} name={`p.${k}.phone`} className={input} />
                  </div>
                  <div>
                    <label htmlFor={id("addr")} className={label}>
                      Mailing address{optional}
                    </label>
                    <AddressInput id={id("addr")} name={`p.${k}.mailing_address`} className={input} />
                  </div>
                </div>
                {canEditRoles ? (
                  <RoleBoxes prefix={`p.${k}`} selected={["owner"]} />
                ) : (
                  <p className="text-[12px] text-mute">A board admin can give them a role once they are added.</p>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor={id("existing")} className={label}>
                  Person
                </label>
                {people.length === 0 ? (
                  <p className="mt-1 text-[12px] text-mute">No one is on file yet. Choose “Someone new” instead.</p>
                ) : (
                  <select id={id("existing")} name={`p.${k}.existing_person_id`} required defaultValue="" className={input}>
                    <option value="" disabled>
                      Choose a person
                    </option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-[40px] items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" name={`p.${k}.owns_unit`} defaultChecked className="h-4 w-4 rounded border-line-strong accent-ink" />
                They own this unit
              </label>
              <div>
                <label htmlFor={id("since")} className={label}>
                  Owner since
                </label>
                <input id={id("since")} name={`p.${k}.effective_from`} type="date" defaultValue={todayIso()} className={input} />
              </div>
            </div>
          </div>
        );
      })}

      {total === 0 ? <p className="text-[12px] text-mute">No one is in this unit. It is saved as vacant.</p> : null}
      <button type="button" onClick={addOne} className={ghost}>
        {total === 0 ? "Add a person" : "Add another person"}
      </button>
    </div>
  );
}
