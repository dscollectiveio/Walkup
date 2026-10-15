"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoImport } from "../actions";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorNote } from "../ui";

export function DoneActions({ batchId, canUndo, links }: { batchId: string; canUndo: boolean; links: { href: string; label: string }[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (undone) {
    return (
      <div className="space-y-3">
        <p role="status" className="border-l-[3px] border-good bg-good-tint px-4 py-3 text-[13px] text-good-text">
          Undone. Nothing from this import is counted any more. The entries and their reversals stay in the ledger history.
        </p>
        <Link href="/building/import" className={BTN_PRIMARY}>
          Done
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Link key={l.href + l.label} href={l.href} className={BTN_SECONDARY}>
            {l.label}
          </Link>
        ))}
        {canUndo && !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className={BTN_SECONDARY}>
            Undo this import
          </button>
        ) : null}
        <Link href="/building/import" className={BTN_PRIMARY}>
          Done
        </Link>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
          <span>This reverses the entries. Both stay in the ledger history. Undo?</span>
          <button
            type="button"
            disabled={pending}
            className={BTN_SECONDARY}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await undoImport(batchId);
                if ("error" in r) setError(r.error);
                else {
                  setUndone(true);
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Undoing..." : "Yes, undo"}
          </button>
          <button type="button" disabled={pending} className={BTN_SECONDARY} onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}
