"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { declineQuote, deleteQuote, undeclineQuote } from "../quote-actions";
import { ConfirmDialog } from "./confirm-dialog";
import { Sheet, SheetFooter } from "./sheet";
import { btnDanger, btnGhost, btnPrimary, inputClass, labelClass } from "./styles";

/**
 * The quote buttons shared by the Quotes tab, Compare, the quote page and the
 * contact page (§9.7 item 3, §9.10): record the board's choice (which buys
 * nothing), decline with an optional reason, undo a decline, delete (admin).
 */

const small = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";

/** "Record our choice": a confirm that says what it does and doesn't do, then the from_quote flow (§9.4.2). */
export function RecordChoiceButton({ quoteId, contactName, primary = false }: { quoteId: string; contactName: string | null; primary?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={primary ? btnPrimary : small} onClick={() => setOpen(true)}>
        Record our choice
      </button>
      <ConfirmDialog
        open={open}
        title="Record our choice"
        body={`This records your choice in Walkup. It doesn't accept the quote or buy anything. Tell ${contactName ?? "the agency"} you'd like to go ahead.`}
        confirmLabel="Record our choice"
        pendingLabel="Opening…"
        onConfirm={async () => {
          router.push(`/insurance/policies/new?from_quote=${quoteId}`);
          return { ok: true };
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function DeclineQuoteButton({ quoteId, carrier }: { quoteId: string; carrier: string }) {
  const router = useRouter();
  const p = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={small} onClick={() => setOpen(true)} aria-label={`Decline the ${carrier} quote`}>
        Decline
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Decline the quote">
        <div className="flex h-full flex-col">
          <div className="flex-1 space-y-3 px-5 py-5">
            <h2 className="text-[16px] font-bold tracking-tight text-ink">Decline the {carrier} quote</h2>
            <p className="text-[13px] text-mute">This only records it in Walkup. You can write a short thank-you to the agency afterwards.</p>
            <div>
              <label htmlFor={`${p}-reason`} className={labelClass}>
                Reason <span className="font-normal text-mute-soft">optional, only the board sees it</span>
              </label>
              <textarea id={`${p}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </div>
          </div>
          <SheetFooter error={error}>
            <button type="button" className={btnGhost} onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await declineQuote(quoteId, reason.trim() || null);
                  if ("error" in r) setError(r.error);
                  else {
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Saving…" : "Decline"}
            </button>
          </SheetFooter>
        </div>
      </Sheet>
    </>
  );
}

export function UndeclineButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={small}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await undeclineQuote(quoteId);
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Saving…" : "Undo decline"}
      </button>
      {error ? <p className="w-full text-[12px] text-bad-text">{error}</p> : null}
    </>
  );
}

/** Admin only: delete a quote (rpc delete_insurance_quote). */
export function DeleteQuoteButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btnDanger} onClick={() => setOpen(true)}>
        Delete
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this quote?"
        body="Its figures and where they came from are removed. The file stays in Documents."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        danger
        onConfirm={async () => {
          const r = await deleteQuote(quoteId);
          if ("ok" in r) router.push("/insurance?view=quotes");
          return r;
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
