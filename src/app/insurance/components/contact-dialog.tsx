"use client";

import { useId, useState, useTransition } from "react";
import { COVERAGE_TYPES, type CoverageType } from "@/lib/insurance/coverage";
import { saveContact, type ContactInput, type ContactKind } from "../contact-actions";
import { Sheet, SheetFooter } from "./sheet";
import { btnGhost, btnPrimary, helpClass, inputClass, labelClass } from "./styles";

/**
 * Add or edit an insurance contact (§9.6 item 3, §9.11): the board's agent,
 * an agency it knows, an insurer. Saving one isn't an endorsement and sends
 * nothing.
 */

export interface ContactDialogValue {
  id: string;
  kind: string;
  name: string;
  person_name: string | null;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  city: string | null;
  state_code: string | null;
  lines: string[];
  is_current_agent: boolean;
  notes: string | null;
}

const KINDS: { value: ContactKind; label: string }[] = [
  { value: "agency", label: "Agency" },
  { value: "agent", label: "Agent" },
  { value: "broker", label: "Broker" },
  { value: "insurer", label: "Insurer" },
  { value: "adjuster", label: "Adjuster" },
  { value: "other", label: "Other" },
];

export function ContactDialog({
  open,
  contact,
  onClose,
  onSaved,
}: {
  open: boolean;
  contact: ContactDialogValue | null;
  onClose: () => void;
  onSaved: (contactId: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} label={contact ? "Edit the contact" : "Add a contact"}>
      <ContactForm contact={contact} onCancel={onClose} onSaved={onSaved} />
    </Sheet>
  );
}

function ContactForm({
  contact,
  onCancel,
  onSaved,
}: {
  contact: ContactDialogValue | null;
  onCancel: () => void;
  onSaved: (contactId: string) => void;
}) {
  const p = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Set<string>>(new Set(contact?.lines ?? []));

  const field = (key: string, label: string, input: React.ReactNode, help?: string) => (
    <div>
      <label htmlFor={`${p}-${key}`} className={labelClass}>
        {label}
      </label>
      {input}
      {help ? <p className={helpClass}>{help}</p> : null}
      {fieldErrors[key] ? <p className="mt-1 text-[12px] text-bad-text">{fieldErrors[key]}</p> : null}
    </div>
  );

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const s = (k: string) => {
          const v = String(fd.get(k) ?? "").trim();
          return v === "" ? null : v;
        };
        const input: ContactInput = {
          id: contact?.id ?? null,
          kind: (s("kind") ?? "agency") as ContactKind,
          name: s("name") ?? "",
          personName: s("person_name"),
          email: s("email"),
          phone: s("phone"),
          websiteUrl: s("website_url"),
          city: s("city"),
          stateCode: s("state_code"),
          lines: [...lines] as CoverageType[],
          isCurrentAgent: fd.get("is_current_agent") === "on",
          notes: s("notes"),
        };
        start(async () => {
          setError(null);
          setFieldErrors({});
          const r = await saveContact(input);
          if ("error" in r) {
            setError(r.error);
            setFieldErrors(r.fieldErrors ?? {});
          } else onSaved(r.contactId);
        });
      }}
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <h2 className="text-[16px] font-bold tracking-tight text-ink">{contact ? "Edit the contact" : "Add a contact"}</h2>
        {field("name", "Name", <input id={`${p}-name`} name="name" required defaultValue={contact?.name ?? ""} className={inputClass} />)}
        {field(
          "kind",
          "Kind",
          <select id={`${p}-kind`} name="kind" defaultValue={contact?.kind ?? "agency"} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>,
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("personName", "Person", <input id={`${p}-personName`} name="person_name" defaultValue={contact?.person_name ?? ""} className={inputClass} />)}
          {field(
            "email",
            "Email",
            <input id={`${p}-email`} name="email" type="email" inputMode="email" defaultValue={contact?.email ?? ""} className={inputClass} />,
          )}
          {field("phone", "Phone", <input id={`${p}-phone`} name="phone" type="tel" defaultValue={contact?.phone ?? ""} className={inputClass} />)}
          {field(
            "websiteUrl",
            "Website",
            <input id={`${p}-websiteUrl`} name="website_url" type="url" inputMode="url" placeholder="https://" defaultValue={contact?.website_url ?? ""} className={inputClass} />,
            "The full address, starting with https://",
          )}
          {field("city", "City", <input id={`${p}-city`} name="city" defaultValue={contact?.city ?? ""} className={inputClass} />)}
          {field(
            "stateCode",
            "State",
            <input id={`${p}-stateCode`} name="state_code" maxLength={2} placeholder="IL" defaultValue={contact?.state_code ?? ""} className={`${inputClass} uppercase`} />,
          )}
        </div>
        <fieldset>
          <legend className={labelClass}>Lines</legend>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {COVERAGE_TYPES.map((c) => (
              <label key={c.value} className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={lines.has(c.value)}
                  onChange={(e) =>
                    setLines((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.value);
                      else next.delete(c.value);
                      return next;
                    })
                  }
                />
                {c.short}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" name="is_current_agent" defaultChecked={contact?.is_current_agent ?? false} />
          This is our current agent
        </label>
        {field("notes", "Notes", <textarea id={`${p}-notes`} name="notes" rows={3} defaultValue={contact?.notes ?? ""} className={inputClass} />)}
      </div>
      <SheetFooter error={error}>
        <button type="button" className={btnGhost} onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={pending}>
          {pending ? "Saving…" : "Save contact"}
        </button>
      </SheetFooter>
    </form>
  );
}
