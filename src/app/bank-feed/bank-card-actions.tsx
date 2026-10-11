"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/** One look for every action on a bank's card, so they read as a set. */
export const CARD_BUTTON =
  "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink transition-colors hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";

/**
 * The row of buttons on a bank's card — Sync now, Show individual accounts,
 * Manage connection — and the panels the last two open beneath it. The panel
 * contents are server-rendered and passed in; this only decides which is open.
 */
export function BankCardActions({
  sync,
  accountsPanel,
  managePanel,
  accountCount,
}: {
  sync: React.ReactNode;
  /** null when there are no accounts to show */
  accountsPanel: React.ReactNode | null;
  /** null for people who can't manage the connection */
  managePanel: React.ReactNode | null;
  accountCount: number;
}) {
  const [open, setOpen] = useState<"accounts" | "manage" | null>(null);
  const toggle = (which: "accounts" | "manage") => setOpen((cur) => (cur === which ? null : which));

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        {sync}
        {accountsPanel ? (
          <button
            type="button"
            onClick={() => toggle("accounts")}
            aria-expanded={open === "accounts"}
            className={CARD_BUTTON}
          >
            {open === "accounts" ? "Hide individual accounts" : `Show individual accounts (${accountCount})`}
            <ChevronDown
              size={14}
              strokeWidth={1.6}
              aria-hidden="true"
              className={`text-mute transition-transform ${open === "accounts" ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}
        {managePanel ? (
          <button
            type="button"
            onClick={() => toggle("manage")}
            aria-expanded={open === "manage"}
            className={CARD_BUTTON}
          >
            Manage connection
            <ChevronDown
              size={14}
              strokeWidth={1.6}
              aria-hidden="true"
              className={`text-mute transition-transform ${open === "manage" ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}
      </div>

      {open === "accounts" && accountsPanel ? <div className="mt-3">{accountsPanel}</div> : null}
      {open === "manage" && managePanel ? (
        <div className="mt-3 rounded-lg border border-line bg-fill/40 p-3">{managePanel}</div>
      ) : null}
    </div>
  );
}
