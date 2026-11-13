"use client";

import { useState } from "react";
import { maskAccount } from "@/lib/dues/payment-details";

/** The saved account number as ••••1234, with a Show control. */
export function MaskedAccount({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="figures">{shown ? value : maskAccount(value)}</span>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        className="min-h-[44px] text-[12px] text-mute underline underline-offset-2 hover:text-ink sm:min-h-0"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </span>
  );
}
