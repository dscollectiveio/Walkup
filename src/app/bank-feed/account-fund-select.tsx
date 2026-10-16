"use client";

import { useState, useTransition } from "react";
import { setBankAccountFund } from "./actions";

/** "Counts as" on a cash account: which fund its money belongs to on Home and in the statements. */
export function AccountFundSelect({
  connectionId,
  plaidAccountId,
  accountName,
  funds,
  current,
}: {
  connectionId: string;
  plaidAccountId: string;
  accountName: string;
  funds: { id: string; label: string }[];
  /** The account's own choice, or "" to follow the connection's fund. */
  current: string;
}) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end">
      <label className="flex items-center gap-1.5 text-[11px] text-mute">
        Counts as
        <select
          value={value}
          disabled={pending}
          aria-label={`Which fund ${accountName} belongs to`}
          onChange={(e) => {
            const next = e.target.value;
            const prev = value;
            setValue(next);
            setError(null);
            start(async () => {
              const result = await setBankAccountFund(connectionId, plaidAccountId, next);
              if (result.error) {
                setValue(prev);
                setError(result.error);
              }
            });
          }}
          className="rounded-md border border-line-strong bg-paper px-1.5 py-1 text-[12px] text-ink disabled:opacity-60"
        >
          <option value="">Same as the bank</option>
          {funds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="mt-1 text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
