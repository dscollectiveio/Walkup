"use client";

import { useState } from "react";

/** Formats digits as the user types into (XXX) XXX-XXXX. Anything past the
 * 10th digit is dropped rather than accumulated — US numbers only. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function PhoneInput({
  id,
  name,
  defaultValue,
  className,
}: {
  id: string;
  name: string;
  defaultValue?: string | null;
  className: string;
}) {
  const [value, setValue] = useState(() => formatPhone(defaultValue ?? ""));

  return (
    <input
      id={id}
      name={name}
      type="tel"
      inputMode="tel"
      placeholder="(555) 123-4567"
      value={value}
      onChange={(e) => setValue(formatPhone(e.target.value))}
      className={className}
    />
  );
}
