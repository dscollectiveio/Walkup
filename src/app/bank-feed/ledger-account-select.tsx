"use client";

import { useState, useTransition } from "react";
import { createCashAccount, setConnectionLedgerAccount } from "./actions";

const NEW = "__new__";

/**
 * Which ledger cash account a bank connection IS. Every posting from the
 * connection uses it as the cash leg, so it has to be right before anything
 * is posted — hence it sits on the connection card, not buried in settings.
 */
export function LedgerAccountSelect({
  connectionId,
  cashAccounts,
  currentId,
}: {
  connectionId: string;
  cashAccounts: { id: string; label: string }[];
  currentId: string | null;
}) {
  const [value, setValue] = useState(currentId ?? "");
  const [newName, setNewName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = (accountId: string) =>
    start(async () => {
      setError(null);
      const result = await setConnectionLedgerAccount(connectionId, accountId);
      if (result.error) setError(result.error);
    });

  return (
    <div className="mb-3 text-[12px]">
      <label className="text-mute">
        In the books, this account is{" "}
        <select
          value={value}
          disabled={pending}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value && e.target.value !== NEW) apply(e.target.value);
          }}
          className="min-h-[44px] max-w-full rounded-lg border border-line-strong bg-paper px-2 py-1 text-[16px] text-ink sm:min-h-0 sm:text-[12px]"
        >
          <option value="">Choose…</option>
          {cashAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value={NEW}>+ New cash account…</option>
        </select>
      </label>
      {value === NEW ? (
        <span className="mt-1 flex items-center gap-1 sm:ml-2 sm:mt-0 sm:inline-flex">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Chase Checking"
            className="min-h-[44px] min-w-0 rounded-lg border border-line-strong bg-paper px-2 py-1 text-[16px] text-ink sm:min-h-0 sm:text-[12px]"
          />
          <button
            type="button"
            disabled={pending || !newName.trim()}
            onClick={() =>
              start(async () => {
                setError(null);
                const created = await createCashAccount(newName);
                if (created.error || !created.accountId) {
                  setError(created.error ?? "Couldn't create the account.");
                  return;
                }
                setValue(created.accountId);
                const result = await setConnectionLedgerAccount(connectionId, created.accountId);
                if (result.error) setError(result.error);
              })
            }
            className="min-h-[44px] rounded-md border border-line-strong px-3 py-1 text-[12px] text-ink hover:bg-fill disabled:opacity-50 sm:min-h-0 sm:px-2 sm:text-[11px]"
          >
            Create
          </button>
        </span>
      ) : null}
      {!currentId && value !== NEW ? (
        <span className="ml-2 text-warning-text">Pick one before posting</span>
      ) : null}
      {error ? <p className="mt-1 text-bad-text">{error}</p> : null}
    </div>
  );
}
