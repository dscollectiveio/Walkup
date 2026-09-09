"use client";

import { useActionState, useState } from "react";
import { saveTaxFiling, markTaxFilingFiled } from "./actions";

/**
 * Save freezes this year's figures with provenance (compute_and_save_tax_filing).
 * Filed locks them forever (lock_tax_filing) — no further save or reclassify
 * is possible once filed_on/locked_at are set, on this row or any of the
 * transactions that fed it.
 */
export function FilingStatus({
  fiscalYearId,
  filing,
  canWrite,
}: {
  fiscalYearId: string;
  filing: { id: string; computed_at: string | null; filed_on: string | null; locked_at: string | null } | null;
  canWrite: boolean;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveTaxFiling, null);
  const [markOpen, setMarkOpen] = useState(false);
  const [markState, markAction, markPending] = useActionState(markTaxFilingFiled, null);

  if (filing?.locked_at) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper px-5 py-4">
        <p className="text-[13px] text-ink">
          Filed {filing.filed_on} — locked. These figures can&rsquo;t be changed or recomputed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink">
          {filing?.computed_at
            ? `Saved ${new Date(filing.computed_at).toLocaleString()}`
            : "Not yet saved this year"}
        </p>
        {canWrite ? (
          <form action={saveAction} className="flex items-center gap-2">
            <input type="hidden" name="fiscal_year_id" value={fiscalYearId} />
            <button
              type="submit"
              disabled={savePending}
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {savePending ? "Saving…" : filing ? "Save again" : "Save this year's figures"}
            </button>
            {filing ? (
              <button
                type="button"
                onClick={() => setMarkOpen(true)}
                className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
              >
                Mark as filed
              </button>
            ) : null}
          </form>
        ) : null}
      </div>
      {saveState?.error ? <p className="text-[11px] text-bad-text">{saveState.error}</p> : null}

      {markOpen ? (
        <form
          action={markAction}
          className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
        >
          <input type="hidden" name="filing_id" value={filing?.id ?? ""} />
          <div>
            <label htmlFor="filed_on" className="block text-[12px] font-medium text-ink">
              Filed on
            </label>
            <input
              id="filed_on"
              name="filed_on"
              type="date"
              required
              className="mt-1 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-ink"
            />
          </div>
          <button
            type="submit"
            disabled={markPending}
            className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
          >
            {markPending ? "Marking…" : "Confirm filed"}
          </button>
          <button
            type="button"
            onClick={() => setMarkOpen(false)}
            className="text-[12px] text-mute underline-offset-2 hover:underline"
          >
            Cancel
          </button>
          {markState?.error ? (
            <p className="w-full text-[11px] text-bad-text">{markState.error}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
