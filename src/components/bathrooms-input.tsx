"use client";

import { useState } from "react";
import { formatBathrooms, snapBathrooms } from "@/lib/building/bathrooms";

/**
 * One box for a unit's bathrooms with one decimal: 1.0, 2.5, 2.0. Type 2 and it
 * shows 2.0 when you leave the box; type 2.3 and it settles on 2.5 (there are
 * only whole and half baths). The form submits the number under `name`.
 */
export function BathroomsInput({
  name,
  defaultValue,
  id,
  className,
}: {
  name: string;
  defaultValue?: number | null;
  id?: string;
  className?: string;
}) {
  const [text, setText] = useState(defaultValue === null || defaultValue === undefined ? "" : formatBathrooms(defaultValue));
  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="2.5"
      value={text}
      onChange={(e) => {
        // Digits and one decimal point with at most one digit after it.
        const cleaned = e.target.value.replace(/[^\d.]/g, "");
        const [int, ...rest] = cleaned.split(".");
        const dec = rest.join("").slice(0, 1);
        setText(rest.length > 0 ? `${int.slice(0, 2)}.${dec}` : int.slice(0, 2));
      }}
      onBlur={() => {
        const v = snapBathrooms(text);
        setText(v === null ? "" : formatBathrooms(v));
      }}
      className={className}
    />
  );
}
