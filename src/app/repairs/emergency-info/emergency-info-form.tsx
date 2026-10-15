"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { btnDanger, btnPrimary, btnSecondary, choiceRow, errorClass, hintClass, inputClass, labelClass, textareaClass } from "@/components/repairs/styles";
import type { BuildingEmergencyInfo } from "@/lib/repairs/emergency";
import {
  deleteEmergencyContact,
  reorderEmergencyContacts,
  saveEmergencyContact,
  saveEmergencyInfo,
  type EmergencyInfoInput,
} from "./actions";

/**
 * The board's editor for the emergency facts and contacts (repairs-spec
 * §14.3). Every field is optional. Placeholders describe what to write and
 * never show a real company's number: a wrong real number is worse than none.
 */

export interface ContactRow {
  id: string;
  name: string;
  label: string | null;
  phone: string;
  show_to_owners: boolean;
}

const ANCHOR = "edit-emergency-info";

const FIELDS: { key: keyof EmergencyInfoInput; label: string; placeholder: string; max: number; area?: boolean; tel?: boolean }[] = [
  { key: "water_shutoff_location", label: "Main water shut-off", placeholder: "Where the valve is, for example basement, north wall", max: 200 },
  { key: "gas_utility_name", label: "Gas company", placeholder: "Company name from the gas bill", max: 80 },
  { key: "gas_emergency_phone", label: "Gas company emergency line", placeholder: "The emergency number from the gas bill", max: 40, tel: true },
  { key: "electric_panel_location", label: "Electric panel", placeholder: "Where the panel is, for example basement, by the stairs", max: 200 },
  { key: "electric_utility_name", label: "Power company", placeholder: "Company name from the electric bill", max: 80 },
  { key: "electric_emergency_phone", label: "Power company emergency line", placeholder: "The emergency number from the electric bill", max: 40, tel: true },
  { key: "elevator_company_name", label: "Elevator company", placeholder: "Company name from the service contract", max: 120 },
  { key: "elevator_company_phone", label: "Elevator company phone", placeholder: "Their emergency number from the contract", max: 40, tel: true },
  { key: "other_notes", label: "Other notes", placeholder: "Anything else someone should know in a hurry, like where the roof key is", max: 600, area: true },
];

export function EmergencyInfoForm(props: { building: BuildingEmergencyInfo | null; contacts: ContactRow[]; canDelete: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<EmergencyInfoInput>(() => {
    const b = props.building;
    return Object.fromEntries(FIELDS.map((f) => [f.key, b?.[f.key] ?? ""])) as unknown as EmergencyInfoInput;
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const baseId = useId();

  // "Add" on a row that isn't recorded links here.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${ANCHOR}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  return (
    <div id={ANCHOR} className="scroll-mt-4 space-y-6">
      <Card title="Edit the building's information">
        {!open ? (
          <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
            Edit
          </button>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                setSaved(false);
                const r = await saveEmergencyInfo(values);
                if ("error" in r) setError(r.error);
                else {
                  setSaved(true);
                  router.refresh();
                }
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => {
                const id = `${baseId}-${f.key}`;
                const value = (values[f.key] as string | null) ?? "";
                return (
                  <div key={f.key} className={f.area ? "sm:col-span-2" : undefined}>
                    <label htmlFor={id} className={labelClass}>
                      {f.label}
                    </label>
                    {f.area ? (
                      <textarea id={id} rows={3} maxLength={f.max} value={value} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={textareaClass} />
                    ) : (
                      <input
                        id={id}
                        type={f.tel ? "tel" : "text"}
                        maxLength={f.max}
                        value={value}
                        placeholder={f.placeholder}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        className={inputClass}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={pending} className={btnPrimary}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
                Close
              </button>
              {saved ? (
                <p role="status" className="text-[13px] text-good-text">
                  Saved.
                </p>
              ) : null}
            </div>
            {error ? <p className={errorClass}>{error}</p> : null}
          </form>
        )}
      </Card>

      {open ? <ContactsEditor contacts={props.contacts} canDelete={props.canDelete} /> : null}
    </div>
  );
}

function ContactsEditor({ contacts, canDelete }: { contacts: ContactRow[]; canDelete: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function move(i: number, by: -1 | 1) {
    const ids = contacts.map((c) => c.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    start(async () => {
      setError(null);
      const r = await reorderEmergencyContacts(ids);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <Card title="Board contacts for emergencies" hint="The board types these numbers; Walkup doesn't take them from anyone's profile.">
      <div className="space-y-4">
        {contacts.length === 0 ? <p className="text-[13px] text-mute">No contacts yet.</p> : null}
        <ul className="space-y-3">
          {contacts.map((c, i) => (
            <li key={c.id} className="rounded-lg border border-line p-3">
              <ContactForm contact={c} canDelete={canDelete} />
              {contacts.length > 1 ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className={btnSecondary} disabled={pending || i === 0} onClick={() => move(i, -1)}>
                    Move up<span className="sr-only"> {c.name}</span>
                  </button>
                  <button type="button" className={btnSecondary} disabled={pending || i === contacts.length - 1} onClick={() => move(i, 1)}>
                    Move down<span className="sr-only"> {c.name}</span>
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="rounded-lg border border-dashed border-line-strong p-3">
          <p className="mb-2 text-[13px] font-medium text-ink">Add a contact</p>
          <ContactForm contact={null} canDelete={false} />
        </div>
        {error ? <p className={errorClass}>{error}</p> : null}
      </div>
    </Card>
  );
}

function ContactForm({ contact, canDelete }: { contact: ContactRow | null; canDelete: boolean }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(contact?.name ?? "");
  const [label, setLabel] = useState(contact?.label ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [show, setShow] = useState(contact?.show_to_owners ?? true);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          const r = await saveEmergencyContact({ id: contact?.id ?? null, name, label: label || null, phone, show_to_owners: show });
          if ("error" in r) setMsg({ text: r.error, bad: true });
          else {
            setMsg({ text: "Saved.", bad: false });
            if (!contact) {
              setName("");
              setLabel("");
              setPhone("");
              setShow(true);
            }
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${id}-name`} className={labelClass}>
            Name
          </label>
          <input id={`${id}-name`} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${id}-label`} className={labelClass}>
            Role <span className="font-normal text-mute">(optional)</span>
          </label>
          <input id={`${id}-label`} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="President" className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className={labelClass}>
            Phone
          </label>
          <input id={`${id}-phone`} type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </div>
      </div>
      <label className={choiceRow}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-5 w-5" />
        Show to owners
      </label>
      <p className={hintClass}>Owners see this name and number in the safety steps when they report something urgent.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : contact ? "Save" : "Add contact"}
        </button>
        {contact && canDelete ? (
          confirming ? (
            <>
              <button
                type="button"
                className={btnDanger}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteEmergencyContact(contact.id);
                    if ("error" in r) setMsg({ text: r.error, bad: true });
                    else router.refresh();
                  })
                }
              >
                Delete {contact.name}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className={btnSecondary} onClick={() => setConfirming(true)}>
              Delete
            </button>
          )
        ) : null}
        {msg ? (
          <p role="status" className={msg.bad ? errorClass : "text-[13px] text-good-text"}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
