"use client";

import { useId, useState } from "react";
import { bankMark, bankSuggestions, type BankChoice } from "@/lib/dues/banks";

function Badge({ bank }: { bank: Pick<BankChoice, "mark" | "color"> }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
      style={{ background: bank.color }}
    >
      {bank.mark}
    </span>
  );
}

/** Bank name with a short list of common banks. Any name can be typed. */
export function BankNameField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = bankSuggestions(value);
  const exact = bankMark(value);
  const showList = open && suggestions.length > 0 && !(exact && suggestions.length === 1);

  function pick(b: BankChoice) {
    onChange(b.name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-[12px] font-medium text-ink">
        Bank name
        <span className="ml-1 font-normal text-mute-soft">optional</span>
      </label>
      <div className="relative mt-1">
        {exact ? (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
            <Badge bank={exact} />
          </span>
        ) : null}
        <input
          id={id}
          name={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && showList && suggestions[active]) {
              e.preventDefault();
              pick(suggestions[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={`w-full rounded-lg border border-line-strong py-2 pr-3 text-[16px] text-ink min-h-[44px] sm:min-h-0 sm:text-[13px] ${exact ? "pl-10" : "pl-3"}`}
        />
      </div>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Common banks"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line-strong bg-paper shadow-md"
        >
          {!value.trim() ? <li role="presentation" className="px-3 pt-2 text-[11px] text-mute">Common banks. Or type yours.</li> : null}
          {suggestions.map((b, i) => (
            <li
              key={b.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(b);
              }}
              className={`flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-ink sm:min-h-0 ${i === active ? "bg-fill" : ""}`}
            >
              <Badge bank={b} />
              {b.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
