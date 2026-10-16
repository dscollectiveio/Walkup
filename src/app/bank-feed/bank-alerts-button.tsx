"use client";

import { useState, useTransition } from "react";
import { registerBankWebhook } from "./actions";

/**
 * One-off for a bank connected before PLAID_WEBHOOK_URL was set: tells Plaid
 * to post this connection's alerts (login needed, access revoked) to Walkup.
 * Safe to press again; Plaid just replaces the address with the same one.
 */
export function BankAlertsButton({ connectionId }: { connectionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="flex min-w-0 flex-col items-start">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            setDone(false);
            const result = await registerBankWebhook(connectionId);
            if (result.error) setError(result.error);
            else setDone(true);
          })
        }
        className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill disabled:opacity-50"
      >
        {pending ? "Turning on…" : done ? "Alerts are on" : "Turn on connection alerts"}
      </button>
      {error ? <p className="mt-2 text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
