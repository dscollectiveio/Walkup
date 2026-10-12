"use client";

import { useActionState } from "react";
import { saveTaxFiling } from "./actions";

/**
 * Save freezes this year's figures with provenance (compute_and_save_tax_filing).
 * Filing is recorded on the 1120-H form page (form-actions.ts markFormFiled),
 * which saves the figures if they aren't yet and locks them (lock_tax_filing)
 * in the same step — one "filed" for the form and its figures. Once locked,
 * no further save or reclassify is possible, on this row or on any of the
 * transactions that fed it.
 */
export function FilingStatus({
  fiscalYearId,
  filing,
  canWrite,
  formHref,
}: {
  fiscalYearId: string;
  filing: { id: string; computed_at: string | null; filed_on: string | null; locked_at: string | null } | null;
  canWrite: boolean;
  /** The year's 1120-H form page once it is started, else the forms list. */
  formHref: string;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveTaxFiling, null);

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
          </form>
        ) : null}
      </div>
      {saveState?.error ? <p className="text-[11px] text-bad-text">{saveState.error}</p> : null}
      <p className="text-[12px] text-mute">
        Mark it filed from the{" "}
        <a href={formHref} className="underline underline-offset-2 hover:text-ink">
          1120-H form page
        </a>
        {" "}— that saves these figures if you haven&rsquo;t yet, and locks them.
      </p>
    </div>
  );
}
