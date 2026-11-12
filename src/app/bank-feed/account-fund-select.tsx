"use client";

import { useState, useTransition } from "react";
import { setBankAccountFund } from "./actions";

export interface FundChoice {
  id: string;
  /** Plain words for the menu, e.g. "Day-to-day (operating)". */
  label: string;
  kind: string;
}

/**
 * "Used for" on a cash account: which fund its money belongs to on Home and
 * in the statements. The menu always shows the fund the account is counted in
 * today, so there is no blank "same as the bank" choice to decode.
 *
 * A savings account nobody has decided about yet gets a one-line question
 * under it ("Looks like savings. Set it aside for big repairs?") rather than a
 * silent guess: the treasurer confirms, and either answer saves a choice so
 * the question never returns.
 */
export function AccountFundSelect({
  connectionId,
  plaidAccountId,
  accountName,
  funds,
  current,
  suggestReserve,
}: {
  connectionId: string;
  plaidAccountId: string;
  accountName: string;
  funds: FundChoice[];
  /** The fund this account counts in right now: its own choice, else its bank's. */
  current: string;
  /** Looks like savings, has no choice of its own yet, and a reserve fund exists. */
  suggestReserve: boolean;
}) {
  const [value, setValue] = useState(current);
  const [asking, setAsking] = useState(suggestReserve);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const reserve = funds.find((f) => f.kind === "reserve");
  const operating = funds.find((f) => f.kind === "operating");

  function save(next: string, onFail?: () => void) {
    const prev = value;
    setValue(next);
    setError(null);
    start(async () => {
      const result = await setBankAccountFund(
        connectionId,
        plaidAccountId,
        next,
      );
      if (result.error) {
        setValue(prev);
        setError(result.error);
        onFail?.();
      }
    });
  }

  return (
    <>
      <div className="flex flex-col items-end">
        <label className="flex items-center gap-1.5 text-[12px] text-mute sm:text-[11px]">
          Used for:
          <select
            value={value}
            disabled={pending}
            aria-label={`What ${accountName} is used for`}
            onChange={(e) => {
              setAsking(false);
              save(e.target.value);
            }}
            className="min-h-[44px] max-w-full rounded-md border border-line-strong bg-paper px-1.5 py-1 text-[16px] text-ink disabled:opacity-60 sm:min-h-0 sm:text-[12px]"
          >
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p className="mt-1 text-[11px] text-bad-text">{error}</p>
        ) : null}
      </div>
      {asking && reserve && operating ? (
        <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-fill/60 px-2.5 py-1.5 text-[12px] text-mute">
          <span>
            Looks like a savings account. Count it in your Reserve Fund?
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setAsking(false);
              save(reserve.id, () => setAsking(true));
            }}
            className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
          >
            Yes, reserve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setAsking(false);
              save(operating.id, () => setAsking(true));
            }}
            className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
          >
            No, day-to-day
          </button>
        </div>
      ) : null}
    </>
  );
}
