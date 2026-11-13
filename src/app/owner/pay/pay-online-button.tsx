"use client";

import { useActionState } from "react";
import { btnPrimary } from "@/components/repairs/styles";
import { payDuesOnline, type PayOnlineState } from "./online-actions";

/** "Pay $400 by bank transfer": opens Stripe's page for the unit's full balance. */
export function PayOnlineButton({ unitId, label }: { unitId: string; label: string }) {
  const [state, action, pending] = useActionState<PayOnlineState | null>(async () => payDuesOnline(unitId), null);
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full sm:w-auto`}>
        {pending ? "Opening Stripe…" : label}
      </button>
      {state?.error ? (
        <p role="alert" className="mt-2 text-[12px] text-bad-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
