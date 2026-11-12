"use client";

import { useState, useTransition } from "react";
import { syncBankTransactions } from "./actions";
import { LINK_ACTION } from "./bank-card-actions";

export function SyncButton({ connectionId }: { connectionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <>
      {/* The dot travels with the button, and a phone drops it, so a wrapped line never shows a stray "·". */}
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <span aria-hidden="true" className="hidden text-mute-soft sm:inline">
          ·
        </span>
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
                if (result.posted)
                  parts.push(`${result.posted} posted by your rules`);
                setNote(parts.join(" · "));
                if (result.warning) setError(result.warning);
              }
            })
          }
          className={LINK_ACTION}
        >
          {pending ? "Syncing…" : "Sync now"}
        </button>
      </span>
      {/* basis-full: inside the bank's status line these wrap onto their own row. */}
      {note ? <p className="basis-full text-[12px] text-mute">{note}</p> : null}
      {error ? (
        <p className="basis-full text-[12px] text-bad-text">{error}</p>
      ) : null}
    </>
  );
}
