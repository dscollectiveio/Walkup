"use client";

import { createContext, useContext, useState } from "react";
import { ChevronDown } from "lucide-react";

/** The one solid button on a bank's card. */
export const SHOW_ACCOUNTS_BUTTON =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-3 text-[13px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass";

/** Link-style actions inside an account tile: no border, no fill. */
export const LINK_ACTION =
  "inline-flex h-5 items-center gap-1 whitespace-nowrap text-[12px] leading-5 font-medium text-ink underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";

const ManageContext = createContext<{ open: boolean; toggle: () => void } | null>(null);

/** "Manage connection" on an account tile. Opens the connection's settings under the accounts. */
export function ManageLink() {
  const ctx = useContext(ManageContext);
  if (!ctx) return null;
  return (
    <button type="button" onClick={ctx.toggle} aria-expanded={ctx.open} className={LINK_ACTION}>
      Manage connection
    </button>
  );
}

/**
 * A bank's header line with one solid button on the right, "Show individual
 * accounts". The accounts — each with its own Sync now and Manage connection
 * links — appear beneath it. Panel contents are server-rendered and passed
 * in; this only decides what is open.
 */
export function BankCardActions({
  header,
  accountsPanel,
  managePanel,
  accountCount,
  sync,
}: {
  header: React.ReactNode;
  /** Shown on the bank's own line when there are no accounts to expand, so the bank can still be synced. */
  sync: React.ReactNode;
  /** null when there are no accounts to show */
  accountsPanel: React.ReactNode | null;
  /** null for people who can't manage the connection */
  managePanel: React.ReactNode | null;
  accountCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <ManageContext.Provider
      value={managePanel ? { open: manageOpen, toggle: () => setManageOpen((o) => !o) } : null}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {header}
        {accountsPanel ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={SHOW_ACCOUNTS_BUTTON}
          >
            {open ? "Hide individual accounts" : `Show individual accounts (${accountCount})`}
            <ChevronDown
              size={14}
              strokeWidth={1.6}
              aria-hidden="true"
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1 pt-1">
            {sync}
            {managePanel ? <ManageLink /> : null}
          </div>
        )}
      </div>

      {open && accountsPanel ? <div className="mt-3">{accountsPanel}</div> : null}
      {manageOpen && managePanel && (open || !accountsPanel) ? (
        <div className="mt-3 rounded-lg border border-line bg-fill/40 p-3">{managePanel}</div>
      ) : null}
    </ManageContext.Provider>
  );
}
