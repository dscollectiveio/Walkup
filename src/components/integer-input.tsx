"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { caretAfterFormat, cleanInteger, displayInteger } from "@/lib/format/money-input";

/**
 * A whole-number box that formats as you type: 1250 becomes 1,250. The form
 * submits the plain digits under `name`, so the server reads it as before.
 */
export function IntegerInput({
  name,
  defaultValue,
  id,
  className,
  placeholder,
  maxDigits = 7,
  "aria-label": ariaLabel,
}: {
  name: string;
  defaultValue?: number | null;
  id?: string;
  className?: string;
  placeholder?: string;
  maxDigits?: number;
  "aria-label"?: string;
}) {
  const [raw, setRaw] = useState(() => cleanInteger(defaultValue ? String(defaultValue) : "", maxDigits));
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = displayInteger(raw);

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
        inputMode="numeric"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className}
        onChange={(e) => {
          const next = cleanInteger(e.target.value, maxDigits);
          caret.current = caretAfterFormat(e.target.value, e.target.selectionStart ?? e.target.value.length, displayInteger(next));
          setRaw(next);
        }}
      />
      <input type="hidden" name={name} value={raw} />
    </>
  );
}
