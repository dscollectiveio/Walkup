"use client";

import { createContext, useContext, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";

/** Link-style actions inside an account tile: no border, no fill. */
export const LINK_ACTION =
  "inline-flex h-11 items-center gap-1 sm:h-5 whitespace-nowrap text-[12px] leading-5 font-medium text-ink underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";

const ManageContext = createContext<{
  open: boolean;
  toggle: () => void;
} | null>(null);

/**
 * The "⋯" on a bank's line. Opens the connection's settings (which ledger
 * account it posts to, bank alerts, disconnect) under the accounts. Renders
 * nothing for people who can't manage the connection.
 */
export function ManageLink() {
  const ctx = useContext(ManageContext);
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={ctx.toggle}
      aria-expanded={ctx.open}
      aria-label="Manage connection"
      title="Manage connection"
      className="-my-3 inline-flex h-11 w-8 items-center justify-center rounded text-mute hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass sm:my-0 sm:h-5"
    >
      <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** A bank with more accounts than this gets a quiet show/hide link; fewer are simply shown. */
export const ACCOUNTS_ALWAYS_SHOWN_UP_TO = 3;

/**
 * A bank's card: its header line (logo, name, status, Sync now and the "⋯"
 * menu) and, beneath it, its accounts. Up to three accounts are simply shown;
 * more than that get a quiet "Hide accounts" link. Panel contents are
 * server-rendered and passed in; this only decides what is open.
 */
export function BankCardActions({
  header,
  accountsPanel,
  managePanel,
  accountCount,
}: {
  header: React.ReactNode;
  /** null when there are no accounts to show */
  accountsPanel: React.ReactNode | null;
  /** null for people who can't manage the connection */
  managePanel: React.ReactNode | null;
  accountCount: number;
}) {
  const collapsible = accountCount > ACCOUNTS_ALWAYS_SHOWN_UP_TO;
  const [open, setOpen] = useState(!collapsible);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <ManageContext.Provider
      value={
        managePanel
          ? { open: manageOpen, toggle: () => setManageOpen((o) => !o) }
          : null
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {header}
        {accountsPanel && collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={LINK_ACTION}
          >
            {open ? "Hide accounts" : `Show accounts (${accountCount})`}
            <ChevronDown
              size={14}
              strokeWidth={1.6}
              aria-hidden="true"
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}
      </div>
      {open && accountsPanel ? (
        <div className="mt-3">{accountsPanel}</div>
      ) : null}
      {manageOpen && managePanel ? (
        <div className="mt-3 rounded-lg border border-line bg-fill/40 p-3">
          {managePanel}
        </div>
      ) : null}
    </ManageContext.Provider>
  );
}
