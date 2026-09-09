"use client";

import { useActionState, useState } from "react";
import { setLineClassification, clearLineClassification } from "./actions";

export interface DrilldownLine {
  journalLineId: string;
  date: string;
  amount: string;
  /** The account's default, with any override already applied. */
  isExempt: boolean;
  /** Whether a row in tax_line_classifications exists for this line at all. */
  overridden: boolean;
}

/**
 * Expands one account's total into the individual transactions behind it, so
 * a board member can flag the one atypical entry — a room rental posted to an
 * otherwise-exempt income account — without touching the account's default
 * for everything else. journal_lines are immutable once posted, so this never
 * edits the ledger; it only sets or clears a row in tax_line_classifications.
 */
export function AccountLineDrilldown({
  lines,
  canWrite,
  exemptLabel,
  nonExemptLabel,
}: {
  lines: DrilldownLine[];
  canWrite: boolean;
  exemptLabel: string;
  nonExemptLabel: string;
}) {
  if (lines.length === 0) return null;

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[11px] text-mute underline-offset-2 hover:underline">
        {lines.length} transaction{lines.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 space-y-2 border-l-2 border-line pl-3">
        {lines.map((line) => (
          <LineRow
            key={line.journalLineId}
            line={line}
            canWrite={canWrite}
            exemptLabel={exemptLabel}
            nonExemptLabel={nonExemptLabel}
          />
        ))}
      </ul>
    </details>
  );
}

function LineRow({
  line,
  canWrite,
  exemptLabel,
  nonExemptLabel,
}: {
  line: DrilldownLine;
  canWrite: boolean;
  exemptLabel: string;
  nonExemptLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [setState, setAction, setPending] = useActionState(setLineClassification, null);
  const [clearState, clearAction, clearPending] = useActionState(clearLineClassification, null);

  return (
    <li className="text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-mute">{line.date}</span>
        <span className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              line.isExempt ? "bg-good-tint text-good-text" : "bg-warning-tint text-warning-text"
            }`}
          >
            {line.isExempt ? exemptLabel : nonExemptLabel}
            {line.overridden ? " (overridden)" : ""}
          </span>
          <span className="figures text-ink">{line.amount}</span>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-[11px] text-mute underline-offset-2 hover:underline"
            >
              {open ? "Close" : "Change"}
            </button>
          ) : null}
        </span>
      </div>

      {open ? (
        <div className="mt-1.5 space-y-1.5 rounded-md border border-line bg-fill p-2">
          <form action={setAction} className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="journal_line_id" value={line.journalLineId} />
            <input
              name="note"
              placeholder="Why (optional)"
              className="min-w-0 flex-1 rounded border border-line-strong px-2 py-1 text-[11px] text-ink"
            />
            <button
              type="submit"
              name="is_exempt"
              value="true"
              disabled={setPending}
              className="rounded border border-good-line bg-good-tint px-2 py-1 text-[11px] text-good-text disabled:opacity-50"
            >
              Set {exemptLabel}
            </button>
            <button
              type="submit"
              name="is_exempt"
              value="false"
              disabled={setPending}
              className="rounded border border-warning-line bg-warning-tint px-2 py-1 text-[11px] text-warning-text disabled:opacity-50"
            >
              Set {nonExemptLabel}
            </button>
          </form>
          {line.overridden ? (
            <form action={clearAction}>
              <input type="hidden" name="journal_line_id" value={line.journalLineId} />
              <button
                type="submit"
                disabled={clearPending}
                className="text-[11px] text-mute underline-offset-2 hover:underline disabled:opacity-50"
              >
                Revert to the account&rsquo;s default
              </button>
            </form>
          ) : null}
          {setState?.error ? <p className="text-[11px] text-bad-text">{setState.error}</p> : null}
          {clearState?.error ? <p className="text-[11px] text-bad-text">{clearState.error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
