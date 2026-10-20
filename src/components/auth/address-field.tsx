"use client";

import { useEffect, useId, useRef, useState } from "react";
import { authInput, authLabel } from "@/components/auth/auth-shell";

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

export type AddressValue = Parts;

/**
 * Street address with suggestions. Type a few characters, pick a match with
 * the mouse or arrow keys + Enter, and street / city / state / ZIP fill in
 * below — every one of them editable, because no address source is perfect.
 * The five fields are real inputs (street_address, city, state_code,
 * postal_code, county) submitted with the form; the browser's own address
 * autofill works on them too.
 */
export function AddressField({
  required = true,
  onPick,
  defaultValue,
}: {
  required?: boolean;
  /** Called when a suggestion fills the boxes — the form uses it to pre-fill the short name. */
  onPick?: (a: AddressValue) => void;
  defaultValue?: Partial<AddressValue>;
}) {
  const listId = useId();
  const [query, setQuery] = useState(defaultValue?.street ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [unavailable, setUnavailable] = useState(false);
  const [filled, setFilled] = useState(Boolean(defaultValue?.street));
  const [addr, setAddr] = useState<AddressValue>({
    street: defaultValue?.street ?? "",
    city: defaultValue?.city ?? "",
    state: defaultValue?.state ?? "IL",
    postalCode: defaultValue?.postalCode ?? "",
    county: defaultValue?.county ?? null,
  });
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Debounced lookup; only the latest request is allowed to update the list.
  useEffect(() => {
    const q = query.trim();
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
  }, [query, open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const apply = (a: AddressValue) => {
    setAddr(a);
    setQuery(a.street);
    setFilled(true);
    setOpen(false);
    setItems([]);
    onPick?.(a);
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

  const visible = open && query.trim().length >= 4;
  const set = (k: keyof AddressValue, v: string) => setAddr((a) => ({ ...a, [k]: v }));

  return (
    <div ref={box} className="space-y-3">
      <div className="relative">
        <label htmlFor="street_address" className={authLabel}>
          Building address
          <span className="ml-1 font-normal text-mute-soft">start typing, then pick yours</span>
        </label>
        <input
          id="street_address"
          name="street_address"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            set("street", e.target.value);
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
          placeholder="2158 N. Damen Ave"
          className={authInput}
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
                className={`cursor-pointer px-3.5 py-2.5 text-[14px] text-ink ${i === active ? "bg-fill" : ""}`}
              >
                {s.label}
              </li>
            ))}
            {busy && items.length === 0 ? <li className="px-3.5 py-2.5 text-[13px] text-mute">Looking…</li> : null}
          </ul>
        ) : null}
        {unavailable && visible ? (
          <p className="mt-1.5 text-[12px] text-mute">Suggestions aren&rsquo;t available right now. Type the address in the boxes below.</p>
        ) : null}
      </div>

      <div className={filled ? "grid grid-cols-6 gap-3" : "hidden"} aria-hidden={!filled}>
        <div className="col-span-3">
          <label htmlFor="city" className="block text-[12px] font-medium text-ink">City</label>
          <input id="city" name="city" value={addr.city} onChange={(e) => set("city", e.target.value)} required={required} autoComplete="address-level2" className={authInput} />
        </div>
        <div className="col-span-1">
          <label htmlFor="state_code" className="block text-[12px] font-medium text-ink">State</label>
          <input id="state_code" name="state_code" value={addr.state} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} required={required} maxLength={2} autoComplete="address-level1" className={`${authInput} uppercase`} />
        </div>
        <div className="col-span-2">
          <label htmlFor="postal_code" className="block text-[12px] font-medium text-ink">ZIP</label>
          <input id="postal_code" name="postal_code" value={addr.postalCode} onChange={(e) => set("postalCode", e.target.value)} required={required} inputMode="numeric" autoComplete="postal-code" className={authInput} />
        </div>
        <input type="hidden" name="county" value={addr.county ?? ""} />
      </div>

      {!filled ? (
        <>
          {/* Until an address is picked the state is still submitted. */}
          <input type="hidden" name="state_code" value={addr.state} />
          <p className="text-[12px] text-mute">
            Can&rsquo;t find it?{" "}
            <button type="button" onClick={() => setFilled(true)} className="font-semibold text-ink underline underline-offset-2">
              Enter the city, state and ZIP yourself
            </button>
            .
          </p>
        </>
      ) : addr.state && addr.state !== "IL" ? (
        <p className="rounded-lg border border-warning-line bg-warning-tint px-3.5 py-2.5 text-[13px] text-warning-text">
          Walkup supports Illinois associations today. You can still set up your building, but Illinois-specific tax
          filings won&rsquo;t apply to {addr.state}.
        </p>
      ) : null}
    </div>
  );
}
