"use client";

import { useState, useTransition } from "react";
import { disconnectBank } from "./actions";

export function DisconnectButton({ connectionId }: { connectionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
      >
        Disconnect
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-mute">Disconnect this bank account?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await disconnectBank(connectionId);
            if (result.error) setError(result.error);
            else setConfirming(false);
          })
        }
        className="rounded-md border border-bad-line bg-bad-tint px-3 py-1.5 text-[13px] font-medium text-bad-text hover:bg-bad-tint/80"
      >
        {pending ? "Disconnecting…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[13px] text-mute underline-offset-2 hover:underline"
      >
        Cancel
      </button>
      {error ? <p className="w-full text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
