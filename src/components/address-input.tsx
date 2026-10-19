"use client";

import { useEffect, useId, useRef, useState } from "react";
import { withUnit as addUnit } from "@/lib/address/unit";

interface Parts {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  county: string | null;
}
interface Suggestion {
  label: string;
  placeId: string | null;
  parts: Parts | null;
}

interface Check {
  status: "confirmed" | "unit_missing" | "unit_unconfirmed" | "not_found" | "unavailable";
  standardized: string | null;
  /** The address this answer is about; it is only shown while the box still holds that address. */
  q?: string;
}

/** "2158 N Damen Ave, Chicago, IL 60647" from the parts a suggestion carries. */
export function oneLineAddress(p: Parts): string {
  const stateZip = [p.state, p.postalCode].filter(Boolean).join(" ");
  return [p.street, p.city, stateZip].filter(Boolean).join(", ");
}

/**
 * One address box that guides you to a real address and never traps you in
 * one. Type a few characters and matching addresses appear; pick one with the
 * mouse or arrow keys and Enter and it fills in. Not listed, or you'd rather
 * word it yourself? Keep typing: whatever is in the box is what is saved.
 *
 * A "Unit / Apt" box beside it adds the unit to what is saved, and a USPS check
 * (Google Address Validation, when that API is on) says whether the address is a
 * real delivery point or needs a unit number. The check only informs: nothing is
 * ever blocked or rewritten without a click.
 *
 * `fillNames` lets a form with separate boxes (city, state, ZIP, county) have a
 * pick fill them too: the street goes in this box, the rest into the inputs of
 * the same form with those names. They stay editable.
 */
export function AddressInput({
  name,
  defaultValue,
  id,
  className,
  placeholder = "Start typing an address",
  required,
  fillNames,
  streetOnly = false,
  withUnit = true,
}: {
  name: string;
  defaultValue?: string | null;
  id?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  fillNames?: { city?: string; state?: string; postalCode?: string; county?: string };
  /** Put only the street in this box (for forms with separate city, state and ZIP boxes). */
  streetOnly?: boolean;
  /** Show the Unit / Apt box and the USPS check. Off for a building's own street address. */
  withUnit?: boolean;
}) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [unavailable, setUnavailable] = useState(false);
  const [unit, setUnit] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const checkSeq = useRef(0);
  const composed = withUnit ? addUnit(value, unit) : value;
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (!open || q.length < 4) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/address?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = (await res.json()) as { suggestions?: Suggestion[]; unavailable?: boolean };
        if (mine !== seq.current) return;
        setItems(data.suggestions ?? []);
        setUnavailable(data.unavailable === true || !res.ok);
        setActive(-1);
      } catch {
        if (mine === seq.current) setUnavailable(true);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value, open]);

  // The USPS check, a moment after typing stops, and not while the suggestion list is open.
  useEffect(() => {
    if (!withUnit) return;
    const q = composed.trim();
    if (open || q.length < 8 || !/\d/.test(q)) return;
    const mine = ++checkSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address/validate?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = (await res.json()) as Check;
        if (mine === checkSeq.current) setCheck(data.status === "unavailable" ? null : { ...data, q });
      } catch {
        if (mine === checkSeq.current) setCheck(null);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [composed, open, withUnit]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const fillSiblings = (p: Parts) => {
    const form = input.current?.form;
    if (!form || !fillNames) return;
    const set = (field: string | undefined, v: string | null) => {
      if (!field) return;
      const el = form.elements.namedItem(field);
      if (el instanceof HTMLInputElement) el.value = v ?? "";
    };
    set(fillNames.city, p.city);
    set(fillNames.state, p.state);
    set(fillNames.postalCode, p.postalCode);
    set(fillNames.county, p.county);
  };

  const apply = (p: Parts) => {
    setValue(streetOnly ? p.street : oneLineAddress(p));
    fillSiblings(p);
    setOpen(false);
    setItems([]);
  };

  const pick = async (s: Suggestion) => {
    if (s.parts) return apply(s.parts);
    if (!s.placeId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/address?id=${encodeURIComponent(s.placeId)}`, { cache: "no-store" });
      const data = (await res.json()) as { parts?: Parts };
      if (data.parts) apply(data.parts);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      void pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const visible = open && value.trim().length >= 4;

  // An answer is only about the address it was asked for: edit the box and it disappears until the next check.
  const shown = withUnit && !open && check && check.q === composed.trim() ? check : null;
  const sameAsTyped = shown?.standardized ? shown.standardized.toLowerCase() === composed.trim().toLowerCase() : true;

  return (
    <div className="space-y-1">
    <div className="flex items-start gap-2">
    <div ref={box} className="relative min-w-0 flex-1">
      <input
        ref={input}
        id={id}
        name={withUnit ? undefined : name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        className={className}
      />
      {visible && (items.length > 0 || busy) ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-paper py-1 shadow-lg"
        >
          {items.map((s, i) => (
            <li
              key={s.placeId ?? s.label}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                void pick(s);
              }}
              className={`cursor-pointer px-3 py-2 text-[13px] text-ink ${i === active ? "bg-fill" : ""}`}
            >
              {s.label}
            </li>
          ))}
          {busy && items.length === 0 ? <li className="px-3 py-2 text-[12px] text-mute">Looking…</li> : null}
          <li className="border-t border-line px-3 py-1.5 text-[11px] text-mute-soft">Not listed? Keep typing. What you enter is saved as typed.</li>
        </ul>
      ) : null}
      {unavailable && visible ? <p className="mt-1 text-[11px] text-mute">Suggestions aren&rsquo;t available right now. Type the address yourself.</p> : null}
    </div>
    {withUnit ? (
      <>
        <input type="hidden" name={name} value={composed} />
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value.slice(0, 20))}
          aria-label="Apartment or unit number"
          placeholder="Apt / unit"
          autoComplete="off"
          className={`${className ?? ""} !w-28 shrink-0`}
        />
      </>
    ) : null}
    </div>
    {shown ? (
      <p
        role="status"
        className={`text-[11px] ${
          shown.status === "confirmed" ? "text-good-text" : shown.status === "not_found" ? "text-mute" : "text-warning-text"
        }`}
      >
        {shown.status === "confirmed"
          ? "USPS confirms this address."
          : shown.status === "unit_missing"
            ? "USPS says this building needs a unit number. Add it in the Apt / unit box."
            : shown.status === "unit_unconfirmed"
              ? "USPS knows the building but can't confirm that unit. Check it, or keep it as typed."
              : "USPS can't find this address. You can keep it as typed."}
        {shown.standardized && !sameAsTyped && shown.status !== "not_found" ? (
          <>
            {" "}
            <button
              type="button"
              onClick={() => {
                setValue(shown.standardized as string);
                setUnit("");
                setCheck(null);
              }}
              className="font-medium text-ink underline underline-offset-2"
            >
              Use USPS&rsquo;s spelling
            </button>
          </>
        ) : null}
      </p>
    ) : null}
    </div>
  );
}
