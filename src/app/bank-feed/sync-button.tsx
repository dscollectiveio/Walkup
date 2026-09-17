"use client";

import { useState, useTransition } from "react";
import { syncBankTransactions } from "./actions";

export function SyncButton({ connectionId }: { connectionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            setNote(null);
            const result = await syncBankTransactions(connectionId);
            if (result.error) setError(result.error);
            else {
              const parts = [`${result.count ?? 0} new or changed`];
              if (result.posted) parts.push(`${result.posted} posted by your rules`);
              setNote(parts.join(" · "));
              if (result.warning) setError(result.warning);
            }
          })
        }
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {note ? <p className="mt-2 text-[11px] text-mute">{note}</p> : null}
      {error ? <p className="mt-2 text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
