"use client";

import { useState, useTransition } from "react";
import { syncBankTransactions } from "./actions";

export function SyncButton({ connectionId }: { connectionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await syncBankTransactions(connectionId);
            if (result.error) setError(result.error);
          })
        }
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {error ? <p className="mt-2 text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
