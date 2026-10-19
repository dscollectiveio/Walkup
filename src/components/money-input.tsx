"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { caretAfterFormat, cleanFromNumber, cleanMoney, displayMoney } from "@/lib/format/money-input";

/**
 * A dollar box that formats as you type: 5400 becomes $5,400. The form
 * submits the plain number (no $ or commas) under `name`, so the server
 * actions read it exactly as before. Cents are allowed ($1,234.50) and only
 * shown when typed.
 */
export function MoneyInput({
  name,
  defaultValue,
  onValueChange,
  id,
  className,
  placeholder = "$0",
  required,
  autoFocus,
  "aria-label": ariaLabel,
}: {
  name: string;
  defaultValue?: number | null;
  /** Called with the plain value, e.g. "5400", on every change. */
  onValueChange?: (raw: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
}) {
  const [raw, setRaw] = useState(() => cleanFromNumber(defaultValue));
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = displayMoney(raw);

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });

  return (
    <>
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        className={className}
        onChange={(e) => {
          const next = cleanMoney(e.target.value);
          caret.current = caretAfterFormat(e.target.value, e.target.selectionStart ?? e.target.value.length, displayMoney(next));
          setRaw(next);
          onValueChange?.(next);
        }}
      />
      <input type="hidden" name={name} value={raw} />
    </>
  );
}
