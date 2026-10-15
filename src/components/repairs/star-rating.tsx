"use client";

import { useId } from "react";
import { Star } from "lucide-react";

/**
 * Stars as a radio group (repairs-spec §16): native radios, so arrow keys
 * move between them and each is labelled "1 star" … "5 stars".
 */
export function StarRating({
  value,
  onChange,
  name,
  disabled,
}: {
  value: number | null;
  onChange: (n: number) => void;
  name?: string;
  disabled?: boolean;
}) {
  const auto = useId();
  const group = name ?? `stars-${auto}`;
  return (
    <div role="radiogroup" aria-label="Rating" className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value !== null && n <= value;
        return (
          <label
            key={n}
            className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-md hover:bg-fill has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass"
          >
            <input
              type="radio"
              name={group}
              value={n}
              checked={value === n}
              disabled={disabled}
              onChange={() => onChange(n)}
              className="sr-only"
              aria-label={n === 1 ? "1 star" : `${n} stars`}
            />
            <Star
              size={24}
              strokeWidth={1.6}
              aria-hidden="true"
              className={on ? "fill-brass text-brass" : "text-line-strong"}
            />
          </label>
        );
      })}
    </div>
  );
}
